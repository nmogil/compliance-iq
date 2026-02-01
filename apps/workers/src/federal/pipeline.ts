/**
 * Federal CFR Data Pipeline Orchestrator
 *
 * End-to-end pipeline for fetching, storing, chunking, embedding, and indexing
 * Code of Federal Regulations data. Implements checkpoint-based resumption for
 * resilience against failures.
 *
 * Pipeline Flow:
 * 1. Load checkpoint (if exists) to resume from last position
 * 2. Fetch CFR title XML from eCFR API
 * 3. Parse XML into parts
 * 4. For each part:
 *    a) Store raw XML in R2
 *    b) Chunk sections into embeddings-ready chunks
 *    c) Generate embeddings via OpenAI
 *    d) Upsert vectors to Pinecone with metadata
 *    e) Save checkpoint
 * 5. Clear checkpoint on completion
 * 6. Sync freshness to Convex
 */

import type { Env } from '../types';
import { TARGET_TITLES, getCategoriesForTitle } from './types';
import { fetchCFRTitle, parseCFRXML } from './fetch';
import { storeCFRPart, saveCheckpoint, loadCheckpoint, clearCheckpoint } from './storage';
import { chunkCFRPart } from './chunk';
import type { CFRPart, CFRSection } from './types';
import { embedChunks } from './embed';
import { initPinecone, getIndex, upsertChunks } from '../pinecone';

/**
 * Result of processing a single CFR title
 */
export interface PipelineResult {
  /** Title number processed */
  titleNumber: number;
  /** Whether processing completed successfully */
  success: boolean;
  /** Number of parts processed */
  partsProcessed: number;
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
 * Result of processing all federal titles
 */
export interface BatchPipelineResult {
  /** Whether all titles processed successfully */
  success: boolean;
  /** Number of titles processed */
  titlesProcessed: number;
  /** Total chunks created across all titles */
  totalChunks: number;
  /** Total vectors upserted across all titles */
  totalVectors: number;
  /** Total processing duration in milliseconds */
  durationMs: number;
  /** Individual title results */
  results: PipelineResult[];
}

/**
 * Process a single CFR title through the complete pipeline
 *
 * Orchestrates fetch, store, chunk, embed, and index operations with
 * checkpoint-based resumption. If processing fails mid-title, the checkpoint
 * allows resuming from the last successfully processed part.
 *
 * @param titleNumber CFR title number (e.g., 21 for Food and Drugs)
 * @param env Cloudflare Worker environment bindings
 * @returns Pipeline result with statistics
 *
 * @example
 * ```ts
 * const result = await processCFRTitle(21, env);
 * console.log(`Processed ${result.partsProcessed} parts, ${result.vectorsUpserted} vectors`);
 * ```
 */
export async function processCFRTitle(
  titleNumber: number,
  env: Env
): Promise<PipelineResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let partsProcessed = 0;
  let chunksCreated = 0;
  let vectorsUpserted = 0;

  console.log(`[Pipeline] Processing CFR Title ${titleNumber}`);

  try {
    // Load checkpoint (if exists)
    const checkpoint = await loadCheckpoint(env.DOCUMENTS_BUCKET, titleNumber);
    const resumeFromPart = checkpoint?.lastProcessedPart ?? 0;

    if (checkpoint) {
      console.log(
        `[Pipeline] Resuming from checkpoint: last processed part ${checkpoint.lastProcessedPart}`
      );
    }

    // Fetch and parse title XML
    const xml = await fetchCFRTitle(titleNumber);
    const parsed = parseCFRXML(xml);

    console.log(`[Pipeline] Parsed title ${titleNumber}: ${parsed.parts.length} parts`);

    // Get categories for this title
    const categories = getCategoriesForTitle(titleNumber);
    const category = categories[0]; // Use first category as primary

    // Initialize Pinecone
    const pinecone = initPinecone(env.PINECONE_API_KEY);
    const index = getIndex(pinecone);

    // Process each part
    for (const parsedPart of parsed.parts) {
      // Skip parts already processed (checkpoint resume)
      if (parsedPart.number <= resumeFromPart) {
        console.log(`[Pipeline] Skipping part ${parsedPart.number} (already processed)`);
        continue;
      }

      try {
        console.log(`[Pipeline] Processing part ${parsedPart.number} (${parsedPart.sections.length} sections)`);

        // Store raw XML in R2
        const partXml = await fetchCFRTitle(titleNumber); // In production, we'd fetch per-part
        await storeCFRPart(env.DOCUMENTS_BUCKET, titleNumber, parsedPart.number, partXml);

        // Convert parsed sections to expected format (heading -> title)
        const sections: CFRSection[] = parsedPart.sections.map(s => ({
          number: s.number,
          title: s.heading, // Map 'heading' to 'title'
          text: s.text,
          subsections: s.subsections,
          effectiveDate: s.effectiveDate,
          lastAmended: s.lastAmended,
        }));

        // Convert parsed part to expected format
        const part: CFRPart = {
          number: parsedPart.number,
          name: parsedPart.name,
          sections,
        };

        // Chunk sections
        const chunks = chunkCFRPart(part, {
          titleNumber,
          titleName: parsed.name,
          chapter: 'I', // Simplified for MVP - would extract from XML
          category,
        });

        chunksCreated += chunks.length;

        // Generate embeddings
        const embedded = await embedChunks(chunks, env.OPENAI_API_KEY);

        // Prepare Pinecone records
        const records = embedded.map(({ chunk, embedding }) => ({
          id: chunk.chunkId,
          values: embedding,
          metadata: {
            chunkId: chunk.chunkId,
            sourceId: chunk.sourceId,
            sourceType: 'federal' as const,
            jurisdiction: 'US',
            text: chunk.text,
            citation: chunk.citation,
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks,
            ...(chunk.category ? { category: chunk.category } : {}), // Only include if defined
            indexedAt: new Date().toISOString(),
          },
        }));

        // Upsert to Pinecone
        await upsertChunks(index, records);
        vectorsUpserted += records.length;

        partsProcessed++;

        // Save checkpoint after successful part
        await saveCheckpoint(env.DOCUMENTS_BUCKET, titleNumber, {
          titleNumber,
          lastProcessedPart: parsedPart.number,
          timestamp: new Date().toISOString(),
          chunksProcessed: chunksCreated,
          status: 'in_progress',
        });

        console.log(
          `[Pipeline] Part ${parsedPart.number} complete: ${chunks.length} chunks, ${records.length} vectors`
        );
      } catch (error) {
        const errorMessage = `Part ${parsedPart.number} failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        errors.push(errorMessage);
        console.error(`[Pipeline] ${errorMessage}`);

        // Save failed checkpoint
        await saveCheckpoint(env.DOCUMENTS_BUCKET, titleNumber, {
          titleNumber,
          lastProcessedPart: parsedPart.number - 1, // Resume from previous part
          timestamp: new Date().toISOString(),
          chunksProcessed: chunksCreated,
          status: 'failed',
          error: errorMessage,
        });

        // Continue with next part (don't fail entire title)
        continue;
      }
    }

    // Clear checkpoint on successful completion
    await clearCheckpoint(env.DOCUMENTS_BUCKET, titleNumber);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Pipeline] Title ${titleNumber} complete: ${vectorsUpserted} vectors in ${durationMs}ms`
    );

    return {
      titleNumber,
      success: errors.length === 0,
      partsProcessed,
      chunksCreated,
      vectorsUpserted,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(errorMessage);

    console.error(`[Pipeline] Title ${titleNumber} failed: ${errorMessage}`);

    return {
      titleNumber,
      success: false,
      partsProcessed,
      chunksCreated,
      vectorsUpserted,
      durationMs,
      errors,
    };
  }
}

/**
 * Process all enabled federal CFR titles
 *
 * Processes all 7 target CFR titles sequentially, aggregating results.
 * Continues processing even if individual titles fail.
 *
 * @param env Cloudflare Worker environment bindings
 * @returns Batch pipeline result with aggregated statistics
 *
 * @example
 * ```ts
 * const result = await processAllFederalTitles(env);
 * console.log(`Processed ${result.titlesProcessed} titles, ${result.totalVectors} total vectors`);
 * ```
 */
export async function processAllFederalTitles(env: Env): Promise<BatchPipelineResult> {
  const startTime = Date.now();
  const results: PipelineResult[] = [];

  console.log(`[Pipeline] Starting batch processing of ${TARGET_TITLES.length} federal titles`);

  // Process titles sequentially to avoid overwhelming APIs
  for (const titleConfig of TARGET_TITLES) {
    if (!titleConfig.enabled) {
      console.log(`[Pipeline] Skipping disabled title ${titleConfig.number}`);
      continue;
    }

    try {
      const result = await processCFRTitle(titleConfig.number, env);
      results.push(result);

      console.log(
        `[Pipeline] Title ${titleConfig.number} (${titleConfig.name}): ` +
          `${result.success ? 'SUCCESS' : 'PARTIAL'} - ${result.vectorsUpserted} vectors`
      );
    } catch (error) {
      console.error(
        `[Pipeline] Title ${titleConfig.number} failed completely: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );

      // Add failed result
      results.push({
        titleNumber: titleConfig.number,
        success: false,
        partsProcessed: 0,
        chunksCreated: 0,
        vectorsUpserted: 0,
        durationMs: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      });
    }
  }

  // Aggregate statistics
  const titlesProcessed = results.length;
  const totalChunks = results.reduce((sum, r) => sum + r.chunksCreated, 0);
  const totalVectors = results.reduce((sum, r) => sum + r.vectorsUpserted, 0);
  const success = results.every(r => r.success);
  const durationMs = Date.now() - startTime;

  console.log(
    `[Pipeline] Batch complete: ${titlesProcessed} titles, ${totalVectors} vectors, ${durationMs}ms`
  );

  // Sync to Convex
  try {
    await syncConvexSources(env, {
      success,
      titlesProcessed,
      totalChunks,
      totalVectors,
      durationMs,
      results,
    });
  } catch (error) {
    console.warn(
      `[Pipeline] Convex sync failed (non-fatal): ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }

  return {
    success,
    titlesProcessed,
    totalChunks,
    totalVectors,
    durationMs,
    results,
  };
}

/**
 * Sync pipeline results to Convex sources table
 *
 * Updates freshness tracking in Convex by calling the HTTP API directly.
 * This is a best-effort operation - failures are logged but don't fail the pipeline.
 *
 * @param env Cloudflare Worker environment bindings
 * @param results Batch pipeline results to sync
 */
async function syncConvexSources(
  env: Env,
  results: BatchPipelineResult
): Promise<void> {
  console.log(`[Pipeline] Syncing results to Convex`);

  // For MVP, we'll create/update a single "federal-cfr" source record
  // In production, we might have per-title granularity

  try {
    const response = await fetch(`${env.CONVEX_URL}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: 'sources:updateFederalStatus',
        args: {
          status: results.success ? 'complete' : 'partial',
          lastScrapedAt: Date.now(),
          titlesProcessed: results.titlesProcessed,
          totalVectors: results.totalVectors,
          durationMs: results.durationMs,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Convex API returned ${response.status}: ${await response.text()}`);
    }

    console.log(`[Pipeline] Convex sync successful`);
  } catch (error) {
    // Log but don't throw - sync failure shouldn't fail pipeline
    console.error(
      `[Pipeline] Convex sync error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    throw error; // Re-throw so caller can handle
  }
}
