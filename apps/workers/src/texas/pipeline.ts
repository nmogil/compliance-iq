/**
 * Texas State Data Pipeline Orchestrator
 *
 * End-to-end pipeline for fetching, storing, chunking, embedding, and indexing
 * Texas Statutes and TAC data. Implements checkpoint-based resumption.
 *
 * Pipeline Flow:
 * 1. Load checkpoint (if exists) to resume from last position
 * 2. Fetch source HTML (statutes or TAC)
 * 3. Store raw HTML in R2
 * 4. Chunk sections into embeddings-ready chunks
 * 5. Generate embeddings via OpenAI
 * 6. Upsert vectors to Pinecone with metadata
 * 7. Save checkpoint after each code/title
 * 8. Clear checkpoint on completion
 * 9. Sync freshness to Convex
 */

import type { Env } from '../types';
import {
  getEnabledStatuteCodes,
  getEnabledTACTitles,
  type TexasCodeConfig,
  type TACTitleConfig,
  type TexasChunk,
  type TexasStatuteSection,
  type TACRule,
} from './types';
import { fetchTexasCode } from './fetch-statutes';
import { fetchTACTitle } from './fetch-tac';
import {
  storeTexasStatute,
  storeTACRule,
  saveTexasCheckpoint,
  loadTexasCheckpoint,
  clearTexasCheckpoint,
} from './storage';
import { chunkTexasStatute, chunkTACRule, type TexasChunkContext, type TACChunkContext } from './chunk';
import { embedChunks } from '../federal/embed'; // Reuse federal embed
import { initPinecone, getIndex, upsertChunks } from '../pinecone';

/**
 * Result of processing a single Texas source (statute code or TAC title)
 */
export interface TexasPipelineResult {
  /** Source type processed */
  sourceType: 'statute' | 'tac';
  /** Identifier: Code abbreviation (e.g., "PE") or TAC title number as string (e.g., "16") */
  identifier: string;
  /** Whether processing completed successfully */
  success: boolean;
  /** Number of sections/rules processed */
  sectionsProcessed: number;
  /** Total chunks created */
  chunksCreated: number;
  /** Total vectors upserted to Pinecone */
  vectorsUpserted: number;
  /** Processing duration in milliseconds */
  durationMs: number;
  /** Errors encountered (if any) */
  errors?: string[];
}

/**
 * Result of processing all Texas sources (statutes + TAC)
 */
export interface TexasBatchPipelineResult {
  /** Whether all sources processed successfully */
  success: boolean;
  /** Number of statute codes processed */
  statutesProcessed: number;
  /** Number of TAC titles processed */
  tacTitlesProcessed: number;
  /** Total chunks created across all sources */
  totalChunks: number;
  /** Total vectors upserted across all sources */
  totalVectors: number;
  /** Total processing duration in milliseconds */
  durationMs: number;
  /** Individual source results */
  results: TexasPipelineResult[];
}

/**
 * Process a single Texas statute code through the complete pipeline
 *
 * Orchestrates fetch, store, chunk, embed, and index operations.
 * Handles all sections within the specified code.
 *
 * @param codeConfig Texas code configuration
 * @param env Cloudflare Worker environment bindings
 * @returns Pipeline result with statistics
 *
 * @example
 * ```ts
 * const codeConfig = TARGET_STATUTES.find(c => c.abbreviation === 'PE');
 * const result = await processTexasCode(codeConfig, env);
 * console.log(`Processed ${result.sectionsProcessed} sections, ${result.vectorsUpserted} vectors`);
 * ```
 */
export async function processTexasCode(
  codeConfig: TexasCodeConfig,
  env: Env
): Promise<TexasPipelineResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let sectionsProcessed = 0;
  let chunksCreated = 0;
  let vectorsUpserted = 0;

  console.log(`[TX Pipeline] Processing code ${codeConfig.abbreviation} (${codeConfig.name})`);

  try {
    // Initialize Pinecone
    const pinecone = initPinecone(env.PINECONE_API_KEY);
    const index = getIndex(pinecone);

    // Collect all sections
    const sections: TexasStatuteSection[] = [];
    for await (const section of fetchTexasCode(codeConfig)) {
      sections.push(section);

      // Store raw HTML in R2
      try {
        // Fetch HTML again for storage (in production, we'd cache this)
        const html = `<html><body>${section.text}</body></html>`; // Simplified for now
        await storeTexasStatute(env.DOCUMENTS_BUCKET, section, html);
      } catch (error) {
        const errorMessage = `Failed to store section ${section.section}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        errors.push(errorMessage);
        console.error(`[TX Pipeline] ${errorMessage}`);
      }

      sectionsProcessed++;
    }

    console.log(`[TX Pipeline] Fetched ${sections.length} sections for ${codeConfig.abbreviation}`);

    // Chunk all sections
    const allChunks: TexasChunk[] = [];
    const category = codeConfig.categories[0]; // Use primary category

    for (const section of sections) {
      const context: TexasChunkContext = {
        code: codeConfig.abbreviation,
        codeName: codeConfig.name,
        chapter: section.chapter,
        category,
      };

      const chunks = chunkTexasStatute(section, context);
      allChunks.push(...chunks);
    }

    chunksCreated = allChunks.length;
    console.log(`[TX Pipeline] Created ${chunksCreated} chunks`);

    // Generate embeddings (batch processing)
    // Type assertion: TexasChunk and CFRChunk share same text/chunkId interface
    const embedded = await embedChunks(allChunks as any, env.OPENAI_API_KEY);

    // Prepare Pinecone records
    const records = embedded.map(({ chunk, embedding }) => ({
      id: chunk.chunkId,
      values: embedding,
      metadata: {
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceType: 'state' as const, // Use 'state' to match ChunkMetadata type
        jurisdiction: 'TX',
        text: chunk.text,
        citation: chunk.citation,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        ...(chunk.category ? { category: chunk.category } : {}),
        indexedAt: new Date().toISOString(),
      },
    }));

    // Upsert to Pinecone
    await upsertChunks(index, records);
    vectorsUpserted = records.length;

    const durationMs = Date.now() - startTime;
    console.log(
      `[TX Pipeline] Code ${codeConfig.abbreviation} complete: ${vectorsUpserted} vectors in ${durationMs}ms`
    );

    return {
      sourceType: 'statute',
      identifier: codeConfig.abbreviation,
      success: errors.length === 0,
      sectionsProcessed,
      chunksCreated,
      vectorsUpserted,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(errorMessage);

    console.error(`[TX Pipeline] Code ${codeConfig.abbreviation} failed: ${errorMessage}`);

    return {
      sourceType: 'statute',
      identifier: codeConfig.abbreviation,
      success: false,
      sectionsProcessed,
      chunksCreated,
      vectorsUpserted,
      durationMs,
      errors,
    };
  }
}

/**
 * Process a single TAC title through the complete pipeline
 *
 * Orchestrates fetch, store, chunk, embed, and index operations.
 * Handles all rules within the specified title.
 *
 * @param titleConfig TAC title configuration
 * @param env Cloudflare Worker environment bindings
 * @returns Pipeline result with statistics
 *
 * @example
 * ```ts
 * const titleConfig = TARGET_TAC_TITLES.find(t => t.number === 16);
 * const result = await processTexasTACTitle(titleConfig, env);
 * console.log(`Processed ${result.sectionsProcessed} rules, ${result.vectorsUpserted} vectors`);
 * ```
 */
export async function processTexasTACTitle(
  titleConfig: TACTitleConfig,
  env: Env
): Promise<TexasPipelineResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let sectionsProcessed = 0;
  let chunksCreated = 0;
  let vectorsUpserted = 0;

  console.log(`[TX Pipeline] Processing TAC Title ${titleConfig.number} (${titleConfig.name})`);

  try {
    // Initialize Pinecone
    const pinecone = initPinecone(env.PINECONE_API_KEY);
    const index = getIndex(pinecone);

    // Collect all rules
    const rules: TACRule[] = [];
    for await (const rule of fetchTACTitle(titleConfig)) {
      rules.push(rule);

      // Store raw HTML in R2
      try {
        // Fetch HTML again for storage (in production, we'd cache this)
        const html = `<html><body>${rule.text}</body></html>`; // Simplified for now
        await storeTACRule(env.DOCUMENTS_BUCKET, rule, html);
      } catch (error) {
        const errorMessage = `Failed to store rule ${rule.section}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        errors.push(errorMessage);
        console.error(`[TX Pipeline] ${errorMessage}`);
      }

      sectionsProcessed++;
    }

    console.log(`[TX Pipeline] Fetched ${rules.length} rules for Title ${titleConfig.number}`);

    // Chunk all rules
    const allChunks: TexasChunk[] = [];
    const category = titleConfig.categories[0]; // Use primary category

    for (const rule of rules) {
      const context: TACChunkContext = {
        title: titleConfig.number,
        titleName: titleConfig.name,
        chapter: rule.chapter,
        category,
      };

      const chunks = chunkTACRule(rule, context);
      allChunks.push(...chunks);
    }

    chunksCreated = allChunks.length;
    console.log(`[TX Pipeline] Created ${chunksCreated} chunks`);

    // Generate embeddings (batch processing)
    // Type assertion: TexasChunk and CFRChunk share same text/chunkId interface
    const embedded = await embedChunks(allChunks as any, env.OPENAI_API_KEY);

    // Prepare Pinecone records
    const records = embedded.map(({ chunk, embedding }) => ({
      id: chunk.chunkId,
      values: embedding,
      metadata: {
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceType: 'state' as const, // Use 'state' to match ChunkMetadata type
        jurisdiction: 'TX',
        text: chunk.text,
        citation: chunk.citation,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        ...(chunk.category ? { category: chunk.category } : {}),
        indexedAt: new Date().toISOString(),
      },
    }));

    // Upsert to Pinecone
    await upsertChunks(index, records);
    vectorsUpserted = records.length;

    const durationMs = Date.now() - startTime;
    console.log(
      `[TX Pipeline] TAC Title ${titleConfig.number} complete: ${vectorsUpserted} vectors in ${durationMs}ms`
    );

    return {
      sourceType: 'tac',
      identifier: String(titleConfig.number),
      success: errors.length === 0,
      sectionsProcessed,
      chunksCreated,
      vectorsUpserted,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(errorMessage);

    console.error(`[TX Pipeline] TAC Title ${titleConfig.number} failed: ${errorMessage}`);

    return {
      sourceType: 'tac',
      identifier: String(titleConfig.number),
      success: false,
      sectionsProcessed,
      chunksCreated,
      vectorsUpserted,
      durationMs,
      errors,
    };
  }
}

/**
 * Process all enabled Texas statute codes
 *
 * Processes all 27 target statute codes sequentially with checkpoint-based
 * resumption. Continues processing even if individual codes fail.
 *
 * @param env Cloudflare Worker environment bindings
 * @returns Batch pipeline result with aggregated statistics
 *
 * @example
 * ```ts
 * const result = await processTexasStatutes(env);
 * console.log(`Processed ${result.statutesProcessed} codes, ${result.totalVectors} vectors`);
 * ```
 */
export async function processTexasStatutes(env: Env): Promise<TexasBatchPipelineResult> {
  const startTime = Date.now();
  const results: TexasPipelineResult[] = [];

  console.log(`[TX Pipeline] Starting Texas Statutes pipeline`);

  // Load checkpoint (if exists)
  const checkpoint = await loadTexasCheckpoint(env.DOCUMENTS_BUCKET, 'statute');
  const enabledCodes = getEnabledStatuteCodes();

  // Determine starting point from checkpoint
  let skipUntilCode: string | null = checkpoint?.lastProcessedCode ?? null;

  for (const codeConfig of enabledCodes) {
    // Skip already-processed codes if resuming
    if (skipUntilCode) {
      if (codeConfig.abbreviation === skipUntilCode) {
        console.log(`[TX Pipeline] Resuming from checkpoint, skipping ${skipUntilCode}`);
        skipUntilCode = null; // Start processing from next code
      }
      continue;
    }

    try {
      const result = await processTexasCode(codeConfig, env);
      results.push(result);

      console.log(
        `[TX Pipeline] Code ${codeConfig.abbreviation}: ${
          result.success ? 'SUCCESS' : 'PARTIAL'
        } - ${result.vectorsUpserted} vectors`
      );

      // Save checkpoint after successful code
      await saveTexasCheckpoint(env.DOCUMENTS_BUCKET, {
        sourceType: 'statute',
        lastProcessedCode: codeConfig.abbreviation,
        timestamp: new Date().toISOString(),
        chunksProcessed: results.reduce((sum, r) => sum + r.chunksCreated, 0),
        status: 'in_progress',
      });
    } catch (error) {
      console.error(
        `[TX Pipeline] Code ${codeConfig.abbreviation} failed completely: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );

      // Add failed result
      results.push({
        sourceType: 'statute',
        identifier: codeConfig.abbreviation,
        success: false,
        sectionsProcessed: 0,
        chunksCreated: 0,
        vectorsUpserted: 0,
        durationMs: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      });
    }
  }

  // Clear checkpoint on completion
  await clearTexasCheckpoint(env.DOCUMENTS_BUCKET, 'statute');

  // Aggregate statistics
  const statutesProcessed = results.length;
  const totalChunks = results.reduce((sum, r) => sum + r.chunksCreated, 0);
  const totalVectors = results.reduce((sum, r) => sum + r.vectorsUpserted, 0);
  const success = results.every(r => r.success);
  const durationMs = Date.now() - startTime;

  console.log(
    `[TX Pipeline] Texas Statutes complete: ${statutesProcessed} codes, ${totalVectors} vectors, ${durationMs}ms`
  );

  return {
    success,
    statutesProcessed,
    tacTitlesProcessed: 0,
    totalChunks,
    totalVectors,
    durationMs,
    results,
  };
}

/**
 * Process all enabled TAC titles
 *
 * Processes all 5 target TAC titles sequentially with checkpoint-based
 * resumption. Continues processing even if individual titles fail.
 *
 * @param env Cloudflare Worker environment bindings
 * @returns Batch pipeline result with aggregated statistics
 *
 * @example
 * ```ts
 * const result = await processTexasTAC(env);
 * console.log(`Processed ${result.tacTitlesProcessed} titles, ${result.totalVectors} vectors`);
 * ```
 */
export async function processTexasTAC(env: Env): Promise<TexasBatchPipelineResult> {
  const startTime = Date.now();
  const results: TexasPipelineResult[] = [];

  console.log(`[TX Pipeline] Starting Texas TAC pipeline`);

  // Load checkpoint (if exists)
  const checkpoint = await loadTexasCheckpoint(env.DOCUMENTS_BUCKET, 'tac');
  const enabledTitles = getEnabledTACTitles();

  // Determine starting point from checkpoint
  let skipUntilTitle: number | null = checkpoint?.lastProcessedTitle ?? null;

  for (const titleConfig of enabledTitles) {
    // Skip already-processed titles if resuming
    if (skipUntilTitle) {
      if (titleConfig.number === skipUntilTitle) {
        console.log(`[TX Pipeline] Resuming from checkpoint, skipping Title ${skipUntilTitle}`);
        skipUntilTitle = null; // Start processing from next title
      }
      continue;
    }

    try {
      const result = await processTexasTACTitle(titleConfig, env);
      results.push(result);

      console.log(
        `[TX Pipeline] TAC Title ${titleConfig.number}: ${
          result.success ? 'SUCCESS' : 'PARTIAL'
        } - ${result.vectorsUpserted} vectors`
      );

      // Save checkpoint after successful title
      await saveTexasCheckpoint(env.DOCUMENTS_BUCKET, {
        sourceType: 'tac',
        lastProcessedTitle: titleConfig.number,
        timestamp: new Date().toISOString(),
        chunksProcessed: results.reduce((sum, r) => sum + r.chunksCreated, 0),
        status: 'in_progress',
      });
    } catch (error) {
      console.error(
        `[TX Pipeline] TAC Title ${titleConfig.number} failed completely: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );

      // Add failed result
      results.push({
        sourceType: 'tac',
        identifier: String(titleConfig.number),
        success: false,
        sectionsProcessed: 0,
        chunksCreated: 0,
        vectorsUpserted: 0,
        durationMs: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      });
    }
  }

  // Clear checkpoint on completion
  await clearTexasCheckpoint(env.DOCUMENTS_BUCKET, 'tac');

  // Aggregate statistics
  const tacTitlesProcessed = results.length;
  const totalChunks = results.reduce((sum, r) => sum + r.chunksCreated, 0);
  const totalVectors = results.reduce((sum, r) => sum + r.vectorsUpserted, 0);
  const success = results.every(r => r.success);
  const durationMs = Date.now() - startTime;

  console.log(
    `[TX Pipeline] Texas TAC complete: ${tacTitlesProcessed} titles, ${totalVectors} vectors, ${durationMs}ms`
  );

  return {
    success,
    statutesProcessed: 0,
    tacTitlesProcessed,
    totalChunks,
    totalVectors,
    durationMs,
    results,
  };
}

/**
 * Process all Texas sources (statutes + TAC)
 *
 * Runs both statute and TAC pipelines sequentially, aggregating results.
 * This is the main entry point for complete Texas data pipeline.
 *
 * @param env Cloudflare Worker environment bindings
 * @returns Combined batch pipeline result
 *
 * @example
 * ```ts
 * const result = await processAllTexasSources(env);
 * console.log(`Processed ${result.statutesProcessed} codes + ${result.tacTitlesProcessed} titles`);
 * ```
 */
export async function processAllTexasSources(env: Env): Promise<TexasBatchPipelineResult> {
  const startTime = Date.now();

  console.log(`[TX Pipeline] Starting full Texas pipeline (statutes + TAC)`);

  // Process statutes
  const statutesResult = await processTexasStatutes(env);

  // Process TAC
  const tacResult = await processTexasTAC(env);

  // Aggregate results
  const allResults = [...statutesResult.results, ...tacResult.results];
  const totalChunks = statutesResult.totalChunks + tacResult.totalChunks;
  const totalVectors = statutesResult.totalVectors + tacResult.totalVectors;
  const success = statutesResult.success && tacResult.success;
  const durationMs = Date.now() - startTime;

  console.log(
    `[TX Pipeline] Full Texas pipeline complete: ${statutesResult.statutesProcessed} codes, ${tacResult.tacTitlesProcessed} titles, ${totalVectors} vectors, ${durationMs}ms`
  );

  // Sync to Convex (best-effort)
  try {
    await syncConvexTexasSources(env, {
      success,
      statutesProcessed: statutesResult.statutesProcessed,
      tacTitlesProcessed: tacResult.tacTitlesProcessed,
      totalChunks,
      totalVectors,
      durationMs,
      results: allResults,
    });
  } catch (error) {
    console.warn(
      `[TX Pipeline] Convex sync failed (non-fatal): ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }

  return {
    success,
    statutesProcessed: statutesResult.statutesProcessed,
    tacTitlesProcessed: tacResult.tacTitlesProcessed,
    totalChunks,
    totalVectors,
    durationMs,
    results: allResults,
  };
}

/**
 * Sync Texas pipeline results to Convex sources table
 *
 * Updates freshness tracking in Convex by calling the HTTP API directly.
 * This is a best-effort operation - failures are logged but don't fail the pipeline.
 *
 * @param env Cloudflare Worker environment bindings
 * @param results Batch pipeline results to sync
 */
async function syncConvexTexasSources(
  env: Env,
  results: TexasBatchPipelineResult
): Promise<void> {
  console.log(`[TX Pipeline] Syncing results to Convex`);

  try {
    const response = await fetch(`${env.CONVEX_URL}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: 'sources:updateTexasStatus',
        args: {
          status: results.success ? 'complete' : 'error',
          lastScrapedAt: Date.now(),
          statutesProcessed: results.statutesProcessed,
          tacTitlesProcessed: results.tacTitlesProcessed,
          totalVectors: results.totalVectors,
          durationMs: results.durationMs,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Convex API returned ${response.status}: ${await response.text()}`);
    }

    console.log(`[TX Pipeline] Convex sync successful`);
  } catch (error) {
    // Log but don't throw - sync failure shouldn't fail pipeline
    console.error(
      `[TX Pipeline] Convex sync error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    throw error; // Re-throw so caller can handle
  }
}
