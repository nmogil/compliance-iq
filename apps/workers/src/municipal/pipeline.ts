/**
 * Municipal Data Pipeline Orchestrator
 *
 * End-to-end pipeline for fetching, storing, chunking, embedding, and indexing
 * Texas municipal ordinance data. Implements checkpoint-based resumption.
 *
 * Pipeline Flow:
 * 1. Load checkpoint (if exists) to resume from last position
 * 2. For each enabled city:
 *    a. Fetch ordinances via Firecrawl (with markdown caching)
 *    b. Store raw markdown and parsed ordinances in R2
 *    c. Chunk ordinances for embedding
 *    d. Generate embeddings via OpenAI
 *    e. Prepare Pinecone records with municipal metadata
 *    f. Upsert vectors to Pinecone (jurisdiction: TX-{cityId})
 *    g. Save checkpoint
 * 3. Clear checkpoint on completion
 * 4. Sync freshness to Convex (best-effort)
 */

import type {
  MunicipalCityConfig,
  MunicipalCheckpoint,
} from './types';
import { getEnabledCities, getCityById, getCityByName } from './cities';
import { fetchCity, type Env as FetchEnv } from './fetch';
import { chunkCity } from './chunk';
import { embedChunks } from '../federal/embed';
import { initPinecone, getIndex, upsertChunks, type ChunkMetadata } from '../pinecone';
import {
  saveMunicipalCheckpoint,
  loadMunicipalCheckpoint,
  clearMunicipalCheckpoint,
  getMunicipalStorageStats,
} from './storage';
import { sleep } from './scraper';

// ============================================================================
// Environment Types
// ============================================================================

/**
 * Combined environment type for pipeline operations
 */
export interface Env extends FetchEnv {
  OPENAI_API_KEY: string;
  PINECONE_API_KEY: string;
  CONVEX_URL?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Delay between cities (rate limiting)
 */
const CITY_DELAY_MS = 2000;

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result from processing a single city through the pipeline
 */
export interface MunicipalPipelineResult {
  /** City display name */
  city: string;
  /** City identifier */
  cityId: string;
  /** Number of ordinances processed */
  ordinancesProcessed: number;
  /** Total chunks created */
  chunksCreated: number;
  /** Chunks that were embedded */
  chunksEmbedded: number;
  /** Vectors upserted to Pinecone */
  chunksIndexed: number;
  /** Firecrawl credits used */
  creditsUsed: number;
  /** Whether markdown was served from cache */
  fromCache: boolean;
  /** Processing duration in milliseconds */
  duration: number;
}

/**
 * Result from processing all cities through the pipeline
 */
export interface MunicipalBatchPipelineResult {
  /** Cities that completed successfully */
  successful: MunicipalPipelineResult[];
  /** Cities that failed with error details */
  failed: Array<{ city: string; error: string; timestamp: string }>;
  /** Cities skipped (disabled) */
  skipped: string[];
  /** Total Firecrawl credits used */
  totalCreditsUsed: number;
  /** Total vectors indexed across all cities */
  totalChunksIndexed: number;
  /** Total processing duration in milliseconds */
  duration: number;
}

// ============================================================================
// Single City Pipeline
// ============================================================================

/**
 * Process a single city: fetch -> store -> chunk -> embed -> index
 *
 * @param env Cloudflare Workers environment
 * @param city City configuration
 * @param options Pipeline options
 * @returns Pipeline result with statistics
 *
 * @example
 * ```typescript
 * const houston = getCityById('houston');
 * const result = await processCity(env, houston!);
 * console.log(`Indexed ${result.chunksIndexed} vectors for ${result.city}`);
 * ```
 */
export async function processCity(
  env: Env,
  city: MunicipalCityConfig,
  options?: { skipCache?: boolean }
): Promise<MunicipalPipelineResult> {
  const startTime = Date.now();

  // Step 1: Fetch and store ordinances
  console.log(`[Municipal Pipeline] Step 1: Fetching ${city.name}...`);
  const fetchResult = await fetchCity(env, city, options);

  // Step 2: Chunk ordinances
  console.log(
    `[Municipal Pipeline] Step 2: Chunking ${fetchResult.ordinances.length} ordinances...`
  );
  const { chunks } = chunkCity(fetchResult.ordinances, city);

  if (chunks.length === 0) {
    console.log(`[Municipal Pipeline] No chunks to embed for ${city.name}`);
    return {
      city: city.name,
      cityId: city.cityId,
      ordinancesProcessed: fetchResult.ordinances.length,
      chunksCreated: 0,
      chunksEmbedded: 0,
      chunksIndexed: 0,
      creditsUsed: fetchResult.creditsUsed,
      fromCache: fetchResult.fromCache,
      duration: Date.now() - startTime,
    };
  }

  // Step 3: Generate embeddings
  console.log(`[Municipal Pipeline] Step 3: Embedding ${chunks.length} chunks...`);

  // Convert to CFRChunk-compatible format for embedChunks
  // embedChunks expects objects with chunkId and text fields
  const chunksForEmbedding = chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    text: chunk.text,
  }));

  const embeddedChunks = await embedChunks(
    chunksForEmbedding as any, // Type assertion for compatibility
    env.OPENAI_API_KEY
  );

  // Step 4: Index in Pinecone
  console.log(`[Municipal Pipeline] Step 4: Indexing ${embeddedChunks.length} vectors...`);

  // Initialize Pinecone
  const pinecone = initPinecone(env.PINECONE_API_KEY);
  const index = getIndex(pinecone);

  // Prepare vectors with municipal metadata
  // Jurisdiction format: TX-{cityId} (e.g., TX-houston)
  const vectors = embeddedChunks.map((embeddedChunk, i) => {
    const originalChunk = chunks[i]!;
    return {
      id: originalChunk.chunkId,
      values: embeddedChunk.embedding,
      metadata: {
        chunkId: originalChunk.chunkId,
        sourceId: `municipal-${city.cityId}-${originalChunk.chapter}-${originalChunk.section}`,
        sourceType: 'municipal' as const,
        jurisdiction: `TX-${city.cityId}`,
        text: originalChunk.text,
        citation: originalChunk.citation,
        title: `${city.name} Code of Ordinances - ${originalChunk.section}`,
        chunkIndex: i,
        totalChunks: chunks.length,
        category: 'municipal-ordinance',
        indexedAt: new Date().toISOString(),
        // Additional municipal-specific metadata
        cityId: city.cityId,
        cityName: city.name,
        chapter: originalChunk.chapter,
        section: originalChunk.section,
        hierarchy: originalChunk.hierarchy.join(' > '),
        sourceUrl: originalChunk.sourceUrl,
      } as ChunkMetadata & {
        cityId: string;
        cityName: string;
        chapter: string;
        section: string;
        hierarchy: string;
        sourceUrl: string;
      },
    };
  });

  await upsertChunks(index, vectors);

  const duration = Date.now() - startTime;

  console.log(
    `[Municipal Pipeline] Completed ${city.name} in ${duration}ms: ${chunks.length} chunks indexed`
  );

  return {
    city: city.name,
    cityId: city.cityId,
    ordinancesProcessed: fetchResult.ordinances.length,
    chunksCreated: chunks.length,
    chunksEmbedded: embeddedChunks.length,
    chunksIndexed: vectors.length,
    creditsUsed: fetchResult.creditsUsed,
    fromCache: fetchResult.fromCache,
    duration,
  };
}

// ============================================================================
// Batch Pipeline
// ============================================================================

/**
 * Process all enabled cities with checkpoint-based resumption
 *
 * Skip-and-log pattern: Individual city failures don't stop the batch.
 *
 * @param env Cloudflare Workers environment
 * @param options Pipeline options
 * @returns Batch pipeline result with aggregated statistics
 *
 * @example
 * ```typescript
 * const result = await processAllCities(env, { resumeFromCheckpoint: true });
 * console.log(`Processed ${result.successful.length} cities, ${result.totalChunksIndexed} vectors`);
 * ```
 */
export async function processAllCities(
  env: Env,
  options?: {
    /** Resume from checkpoint if available */
    resumeFromCheckpoint?: boolean;
    /** Skip cache and force fresh scrape */
    skipCache?: boolean;
    /** Optional: only process specific cities */
    cityFilter?: string[];
  }
): Promise<MunicipalBatchPipelineResult> {
  const startTime = Date.now();
  const result: MunicipalBatchPipelineResult = {
    successful: [],
    failed: [],
    skipped: [],
    totalCreditsUsed: 0,
    totalChunksIndexed: 0,
    duration: 0,
  };

  // Get cities to process
  let cities = getEnabledCities();

  if (options?.cityFilter && options.cityFilter.length > 0) {
    cities = cities.filter(
      (c) => options.cityFilter!.includes(c.cityId) || options.cityFilter!.includes(c.name)
    );
  }

  // Load checkpoint for resumption
  let processedCities: string[] = [];
  if (options?.resumeFromCheckpoint) {
    const checkpoint = await loadMunicipalCheckpoint(env);
    if (checkpoint) {
      processedCities = [...checkpoint.processedCities];
      console.log(`[Municipal Pipeline] Resuming: ${processedCities.length} cities already processed`);
      cities = cities.filter((c) => !processedCities.includes(c.cityId));
    }
  }

  console.log(`[Municipal Pipeline] Processing ${cities.length} cities...`);

  // Process cities sequentially
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    if (!city) continue;

    try {
      console.log(`[Municipal Pipeline] Processing ${city.name} (${i + 1}/${cities.length})...`);

      const pipelineResult = await processCity(env, city, { skipCache: options?.skipCache });
      result.successful.push(pipelineResult);
      result.totalCreditsUsed += pipelineResult.creditsUsed;
      result.totalChunksIndexed += pipelineResult.chunksIndexed;

      // Update checkpoint
      processedCities.push(city.cityId);
      await saveMunicipalCheckpoint(env, {
        lastProcessedCity: city.cityId,
        processedCities,
        lastUpdated: new Date().toISOString(),
      });

      // Delay between cities
      if (i < cities.length - 1) {
        await sleep(CITY_DELAY_MS);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Municipal Pipeline] FAILED ${city.name}:`, errorMessage);

      result.failed.push({
        city: city.name,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      // Continue to next city (skip-and-log pattern)
    }
  }

  result.duration = Date.now() - startTime;

  console.log(
    `[Municipal Pipeline] Batch complete: ${result.successful.length} succeeded, ${result.failed.length} failed in ${result.duration}ms`
  );

  // Clear checkpoint on successful completion
  if (result.failed.length === 0 && result.successful.length > 0) {
    await clearMunicipalCheckpoint(env);
    console.log('[Municipal Pipeline] Checkpoint cleared after successful completion');
  }

  // Sync to Convex (best-effort)
  if (env.CONVEX_URL) {
    try {
      await syncConvexMunicipalSources(env, result);
    } catch (error) {
      console.warn(
        `[Municipal Pipeline] Convex sync failed (non-fatal): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Process a single city by ID or name (HTTP endpoint helper)
 *
 * @param env Cloudflare Workers environment
 * @param cityIdOrName City identifier or display name
 * @param options Pipeline options
 * @returns Pipeline result
 *
 * @example
 * ```typescript
 * const result = await processSingleCity(env, 'houston');
 * // or
 * const result = await processSingleCity(env, 'Houston');
 * ```
 */
export async function processSingleCity(
  env: Env,
  cityIdOrName: string,
  options?: { skipCache?: boolean }
): Promise<MunicipalPipelineResult> {
  const city = getCityById(cityIdOrName) ?? getCityByName(cityIdOrName);

  if (!city) {
    throw new Error(`City not found: ${cityIdOrName}`);
  }

  if (!city.enabled) {
    throw new Error(`City is disabled: ${city.name} (${city.skipReason ?? 'no reason given'})`);
  }

  return processCity(env, city, options);
}

/**
 * Get pipeline status
 *
 * @param env Cloudflare Workers environment
 * @returns Status including checkpoint, storage stats, and city count
 *
 * @example
 * ```typescript
 * const status = await getMunicipalPipelineStatus(env);
 * console.log(`${status.enabledCities} cities, ${status.storage.totalOrdinances} ordinances`);
 * ```
 */
export async function getMunicipalPipelineStatus(env: Env): Promise<{
  checkpoint: MunicipalCheckpoint | null;
  storage: Awaited<ReturnType<typeof getMunicipalStorageStats>>;
  enabledCities: number;
}> {
  const [checkpoint, storage] = await Promise.all([
    loadMunicipalCheckpoint(env),
    getMunicipalStorageStats(env),
  ]);

  return {
    checkpoint,
    storage,
    enabledCities: getEnabledCities().length,
  };
}

/**
 * Clear pipeline state for fresh run
 *
 * @param env Cloudflare Workers environment
 *
 * @example
 * ```typescript
 * await resetMunicipalPipeline(env);
 * console.log('Pipeline reset, ready for fresh run');
 * ```
 */
export async function resetMunicipalPipeline(env: Env): Promise<void> {
  await clearMunicipalCheckpoint(env);
  console.log('[Municipal Pipeline] Checkpoint cleared');
}

// ============================================================================
// Convex Sync (Best-effort)
// ============================================================================

/**
 * Sync municipal pipeline results to Convex sources table
 *
 * Updates freshness tracking in Convex by calling the HTTP API directly.
 * This is a best-effort operation - failures are logged but don't fail the pipeline.
 *
 * @param env Cloudflare Worker environment bindings
 * @param results Batch pipeline results to sync
 */
async function syncConvexMunicipalSources(
  env: Env,
  results: MunicipalBatchPipelineResult
): Promise<void> {
  if (!env.CONVEX_URL) {
    return;
  }

  console.log(`[Municipal Pipeline] Syncing results to Convex`);

  try {
    const response = await fetch(`${env.CONVEX_URL}/api/mutation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: 'sources:updateMunicipalStatus',
        args: {
          status: results.failed.length === 0 ? 'complete' : 'partial',
          lastScrapedAt: Date.now(),
          citiesProcessed: results.successful.length,
          totalVectors: results.totalChunksIndexed,
          totalCreditsUsed: results.totalCreditsUsed,
          durationMs: results.duration,
          failedCities: results.failed.map((f) => f.city),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Convex API returned ${response.status}: ${await response.text()}`);
    }

    console.log(`[Municipal Pipeline] Convex sync successful`);
  } catch (error) {
    // Log but don't throw - sync failure shouldn't fail pipeline
    console.error(
      `[Municipal Pipeline] Convex sync error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
    throw error; // Re-throw so caller can handle (but this is best-effort)
  }
}
