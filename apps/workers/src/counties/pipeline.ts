/**
 * County Data Pipeline Orchestrator
 *
 * End-to-end pipeline for fetching, storing, chunking, embedding, and indexing
 * Texas county ordinance data. Implements checkpoint-based resumption.
 *
 * Pipeline Flow:
 * 1. Load checkpoint (if exists) to resume from last position
 * 2. For each enabled county:
 *    a. Fetch ordinances via adapter
 *    b. Store raw HTML in R2
 *    c. Chunk ordinances
 *    d. Generate embeddings via OpenAI
 *    e. Prepare Pinecone records with metadata
 *    f. Upsert vectors to Pinecone
 *    g. Save checkpoint
 * 3. Clear checkpoint on completion
 * 4. Sync freshness to Convex (best-effort)
 */

import type { Env } from '../types';
import type { CountySourceConfig, CountyOrdinance, CountyChunk } from './types';
import { getEnabledCounties } from './sources';
import { getAdapterForCounty } from './adapters';
import {
  storeCountyOrdinance,
  saveCountyCheckpoint,
  loadCountyCheckpoint,
  clearCountyCheckpoint,
} from './storage';
import { chunkCountyOrdinance, type CountyChunkContext } from './chunk';
import { embedChunks } from '../federal/embed'; // Reuse federal embed
import { initPinecone, getIndex, upsertChunks } from '../pinecone';

/**
 * Result of processing a single county through the pipeline
 */
export interface CountyPipelineResult {
  /** County name */
  county: string;
  /** County FIPS code */
  fipsCode: string;
  /** Whether processing completed successfully */
  success: boolean;
  /** Number of ordinances processed */
  ordinancesProcessed: number;
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
 * Result of processing all enabled counties
 */
export interface CountyBatchPipelineResult {
  /** Whether all counties processed successfully */
  success: boolean;
  /** Number of counties processed */
  countiesProcessed: number;
  /** Total chunks created across all counties */
  totalChunks: number;
  /** Total vectors upserted across all counties */
  totalVectors: number;
  /** Total processing duration in milliseconds */
  durationMs: number;
  /** Individual county results */
  results: CountyPipelineResult[];
}

/**
 * Process a single county through the complete pipeline
 *
 * Orchestrates fetch, store, chunk, embed, and index operations.
 * Handles all ordinances within the specified county.
 *
 * @param config County source configuration
 * @param env Cloudflare Worker environment bindings
 * @returns Pipeline result with statistics
 *
 * @example
 * ```ts
 * const harrisConfig = getCountyByName('Harris');
 * const result = await processCounty(harrisConfig, env);
 * console.log(`Processed ${result.ordinancesProcessed} ordinances, ${result.vectorsUpserted} vectors`);
 * ```
 */
export async function processCounty(
  config: CountySourceConfig,
  env: Env
): Promise<CountyPipelineResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let ordinancesProcessed = 0;
  let chunksCreated = 0;
  let vectorsUpserted = 0;

  console.log(`[County Pipeline] Processing ${config.name} County (${config.fipsCode})`);

  try {
    // Get adapter for this county
    const adapter = getAdapterForCounty(config.name);

    if (!adapter) {
      throw new Error(`No adapter available for county: ${config.name}`);
    }

    // Validate source is accessible
    const validation = await adapter.validateSource();
    if (!validation.accessible) {
      throw new Error(`Source validation failed: ${validation.error}`);
    }

    // Initialize Pinecone
    const pinecone = initPinecone(env.PINECONE_API_KEY);
    const index = getIndex(pinecone);

    // Collect all ordinances
    const ordinances: CountyOrdinance[] = [];
    for await (const ordinance of adapter.fetchOrdinances()) {
      ordinances.push(ordinance);

      // Store raw HTML in R2
      try {
        await storeCountyOrdinance(env.DOCUMENTS_BUCKET, ordinance, ordinance.text);
      } catch (error) {
        const errorMessage = `Failed to store ordinance ${ordinance.chapter}/${ordinance.section}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`;
        errors.push(errorMessage);
        console.error(`[County Pipeline] ${errorMessage}`);
      }

      ordinancesProcessed++;

      if (ordinancesProcessed % 10 === 0) {
        console.log(`[County Pipeline] ${config.name} County: ${ordinancesProcessed} ordinances fetched`);
      }
    }

    console.log(`[County Pipeline] Fetched ${ordinances.length} ordinances for ${config.name} County`);

    // Chunk all ordinances
    const allChunks: CountyChunk[] = [];
    const category = config.categories[0]; // Use primary category

    for (const ordinance of ordinances) {
      const context: CountyChunkContext = {
        county: config.name,
        fipsCode: config.fipsCode,
        codeName: 'Code of Ordinances',
        category,
      };

      const chunks = chunkCountyOrdinance(ordinance, context);
      allChunks.push(...chunks);
    }

    chunksCreated = allChunks.length;
    console.log(`[County Pipeline] Created ${chunksCreated} chunks`);

    if (chunksCreated === 0) {
      console.log(`[County Pipeline] No chunks to embed for ${config.name} County`);
      return {
        county: config.name,
        fipsCode: config.fipsCode,
        success: errors.length === 0,
        ordinancesProcessed,
        chunksCreated,
        vectorsUpserted,
        durationMs: Date.now() - startTime,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    // Generate embeddings (batch processing)
    // Type assertion: CountyChunk has text/chunkId like CFRChunk
    const embedded = await embedChunks(allChunks as any, env.OPENAI_API_KEY);

    // Prepare Pinecone records with county metadata
    // Jurisdiction format: TX-{fipsCode} (e.g., "TX-48201" for Harris County)
    const records = embedded.map(({ chunk, embedding }) => {
      // Cast back to CountyChunk to access county-specific fields
      const countyChunk = chunk as unknown as CountyChunk;
      return {
        id: countyChunk.chunkId,
        values: embedding,
        metadata: {
          chunkId: countyChunk.chunkId,
          sourceId: countyChunk.sourceId,
          sourceType: 'county' as const,
          jurisdiction: `TX-${config.fipsCode}`,
          text: countyChunk.text,
          citation: countyChunk.citation,
          url: countyChunk.url,
          chunkIndex: countyChunk.chunkIndex,
          totalChunks: countyChunk.totalChunks,
          ...(countyChunk.category ? { category: countyChunk.category } : {}),
          indexedAt: new Date().toISOString(),
        },
      };
    });

    // Upsert to Pinecone
    await upsertChunks(index, records);
    vectorsUpserted = records.length;

    const durationMs = Date.now() - startTime;
    console.log(
      `[County Pipeline] ${config.name} County complete: ${vectorsUpserted} vectors in ${durationMs}ms`
    );

    return {
      county: config.name,
      fipsCode: config.fipsCode,
      success: errors.length === 0,
      ordinancesProcessed,
      chunksCreated,
      vectorsUpserted,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    errors.push(errorMessage);

    console.error(`[County Pipeline] ${config.name} County failed: ${errorMessage}`);

    return {
      county: config.name,
      fipsCode: config.fipsCode,
      success: false,
      ordinancesProcessed,
      chunksCreated,
      vectorsUpserted,
      durationMs,
      errors,
    };
  }
}

/**
 * Process all enabled Texas counties through the pipeline
 *
 * Processes all 10 target counties sequentially with checkpoint-based
 * resumption. Continues processing even if individual counties fail.
 *
 * @param env Cloudflare Worker environment bindings
 * @returns Batch pipeline result with aggregated statistics
 *
 * @example
 * ```ts
 * const result = await processAllCounties(env);
 * console.log(`Processed ${result.countiesProcessed} counties, ${result.totalVectors} vectors`);
 * ```
 */
export async function processAllCounties(env: Env): Promise<CountyBatchPipelineResult> {
  const startTime = Date.now();
  const results: CountyPipelineResult[] = [];

  console.log(`[County Pipeline] Starting county pipeline`);

  // Load checkpoint (if exists)
  const checkpoint = await loadCountyCheckpoint(env.DOCUMENTS_BUCKET);
  const enabledCounties = getEnabledCounties();

  console.log(`[County Pipeline] Processing ${enabledCounties.length} enabled counties`);

  // Determine starting point from checkpoint
  let skipUntilCounty: string | null = checkpoint?.lastProcessedCounty ?? null;

  for (const config of enabledCounties) {
    // Skip already-processed counties if resuming
    if (skipUntilCounty) {
      if (config.name === skipUntilCounty) {
        console.log(`[County Pipeline] Resuming from checkpoint, skipping ${skipUntilCounty}`);
        skipUntilCounty = null; // Start processing from next county
      }
      continue;
    }

    try {
      const result = await processCounty(config, env);
      results.push(result);

      console.log(
        `[County Pipeline] ${config.name} County: ${
          result.success ? 'SUCCESS' : 'PARTIAL'
        } - ${result.vectorsUpserted} vectors`
      );

      // Save checkpoint after each county
      await saveCountyCheckpoint(env.DOCUMENTS_BUCKET, {
        sourceType: 'county',
        lastProcessedCounty: config.name,
        timestamp: new Date().toISOString(),
        chunksProcessed: results.reduce((sum, r) => sum + r.chunksCreated, 0),
        status: 'in_progress',
      });
    } catch (error) {
      console.error(
        `[County Pipeline] ${config.name} County failed completely: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );

      // Add failed result
      results.push({
        county: config.name,
        fipsCode: config.fipsCode,
        success: false,
        ordinancesProcessed: 0,
        chunksCreated: 0,
        vectorsUpserted: 0,
        durationMs: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      });
    }
  }

  // Clear checkpoint on completion
  await clearCountyCheckpoint(env.DOCUMENTS_BUCKET);

  // Aggregate statistics
  const countiesProcessed = results.length;
  const totalChunks = results.reduce((sum, r) => sum + r.chunksCreated, 0);
  const totalVectors = results.reduce((sum, r) => sum + r.vectorsUpserted, 0);
  const success = results.every(r => r.success);
  const durationMs = Date.now() - startTime;

  console.log(
    `[County Pipeline] Complete: ${countiesProcessed} counties, ${totalVectors} vectors, ${durationMs}ms`
  );

  // Sync to Convex (best-effort)
  try {
    await syncConvexCountySources(env, {
      success,
      countiesProcessed,
      totalChunks,
      totalVectors,
      durationMs,
      results,
    });
  } catch (error) {
    console.warn(
      `[County Pipeline] Convex sync failed (non-fatal): ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
  }

  return {
    success,
    countiesProcessed,
    totalChunks,
    totalVectors,
    durationMs,
    results,
  };
}

/**
 * Sync county pipeline results to Convex sources table
 *
 * Updates freshness tracking in Convex by calling the HTTP API directly.
 * This is a best-effort operation - failures are logged but don't fail the pipeline.
 *
 * @param env Cloudflare Worker environment bindings
 * @param results Batch pipeline results to sync
 */
async function syncConvexCountySources(
  env: Env,
  results: CountyBatchPipelineResult
): Promise<void> {
  console.log(`[County Pipeline] Syncing results to Convex`);

  try {
    const response = await fetch(`${env.CONVEX_URL}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: 'sources:updateCountyStatus',
        args: {
          status: results.success ? 'complete' : 'error',
          lastScrapedAt: Date.now(),
          countiesProcessed: results.countiesProcessed,
          totalVectors: results.totalVectors,
          durationMs: results.durationMs,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Convex API returned ${response.status}: ${await response.text()}`);
    }

    console.log(`[County Pipeline] Convex sync successful`);
  } catch (error) {
    // Log but don't throw - sync failure shouldn't fail pipeline
    console.error(
      `[County Pipeline] Convex sync error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    throw error; // Re-throw so caller can handle
  }
}
