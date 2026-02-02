/**
 * Municipal Data Fetch Orchestrator
 *
 * Unified interface for fetching ordinances from all enabled cities
 * using Firecrawl. Stores fetched ordinances to R2 with markdown caching.
 *
 * Features:
 * - Markdown cache check first (30-day TTL) to minimize Firecrawl costs
 * - Skip-and-log: failed cities logged but batch continues
 * - Checkpoint updated after each successful city
 * - Sequential processing to avoid API overload
 */

import type {
  MunicipalOrdinance,
  MunicipalCityConfig,
  MunicipalBatchResult,
  MunicipalCheckpoint,
} from './types';
import { getEnabledCities, getCityById, getCityByName } from './cities';
import { scrapeCity, sleep } from './scraper';
import type { Env as ScraperEnv } from './scraper';
import { parseMarkdownToOrdinances, validateOrdinances } from './parser';
import {
  storeMunicipalOrdinances,
  storeMunicipalMarkdown,
  getMunicipalMarkdown,
  saveMunicipalCheckpoint,
  loadMunicipalCheckpoint,
} from './storage';

// ============================================================================
// Environment Types
// ============================================================================

/**
 * Combined environment type for fetch operations
 */
export interface Env extends ScraperEnv {
  FIRECRAWL_API_KEY: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default delay between cities (Firecrawl recommends conservative usage)
 */
const CITY_DELAY_MS = 2000;

/**
 * Default markdown cache TTL (30 days per 05-RESEARCH.md)
 */
const MARKDOWN_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result from fetching a single city
 */
export interface CityFetchResult {
  /** Parsed ordinances */
  ordinances: MunicipalOrdinance[];
  /** Whether markdown was served from cache */
  fromCache: boolean;
  /** Firecrawl credits used (0 if cached) */
  creditsUsed: number;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Fetch and store ordinances for a single city
 *
 * Checks markdown cache first to minimize Firecrawl API costs.
 * Stores both raw markdown (cache) and parsed ordinances.
 *
 * @param env Cloudflare Workers environment
 * @param city City configuration
 * @param options Fetch options
 * @returns Fetch result with ordinances, cache status, and credits used
 *
 * @example
 * ```typescript
 * const result = await fetchCity(env, houston);
 * console.log(`Fetched ${result.ordinances.length} ordinances, credits: ${result.creditsUsed}`);
 * ```
 */
export async function fetchCity(
  env: Env,
  city: MunicipalCityConfig,
  options?: { skipCache?: boolean }
): Promise<CityFetchResult> {
  let markdown: string;
  let fromCache = false;
  let creditsUsed = 0;

  // Check markdown cache first (unless explicitly skipped)
  if (!options?.skipCache) {
    const cached = await getMunicipalMarkdown(env, city.cityId, MARKDOWN_CACHE_TTL_MS);
    if (cached) {
      console.log(
        `[Municipal] Using cached markdown for ${city.name} (scraped ${cached.scrapedAt.toISOString()})`
      );
      markdown = cached.markdown;
      fromCache = true;
    }
  }

  // Scrape if not cached
  if (!fromCache) {
    const scrapeResult = await scrapeCity(env, city);
    markdown = scrapeResult.markdown;
    creditsUsed = scrapeResult.metadata.creditsUsed;

    // Cache the markdown for future runs
    await storeMunicipalMarkdown(env, city.cityId, markdown, {
      title: scrapeResult.metadata.title,
      sourceUrl: scrapeResult.metadata.sourceUrl,
      scrapedAt: new Date(),
    });
  }

  // Parse markdown to ordinances
  const rawOrdinances = parseMarkdownToOrdinances(markdown!, city);

  // Validate and filter
  const { valid: ordinances, warnings } = validateOrdinances(rawOrdinances, city);

  if (warnings.length > 0) {
    console.warn(`[Municipal] ${city.name} had ${warnings.length} parse warnings`);
    for (const warning of warnings.slice(0, 3)) {
      console.warn(`  - ${warning}`);
    }
    if (warnings.length > 3) {
      console.warn(`  ... and ${warnings.length - 3} more warnings`);
    }
  }

  // Store parsed ordinances
  await storeMunicipalOrdinances(env, ordinances);

  console.log(
    `[Municipal] Stored ${ordinances.length} ordinances for ${city.name} (cache: ${fromCache}, credits: ${creditsUsed})`
  );

  return { ordinances, fromCache, creditsUsed };
}

/**
 * Fetch all enabled cities with skip-and-log error handling
 *
 * Per user requirements (05-CONTEXT.md): "Skip and log on failure - mark city as 'needs manual review' and continue"
 *
 * @param env Cloudflare Workers environment
 * @param options Fetch options
 * @returns Batch result with successful, failed, and skipped cities
 *
 * @example
 * ```typescript
 * const result = await fetchAllEnabledCities(env, { resumeFromCheckpoint: true });
 * console.log(`Processed: ${result.successful.length}, Failed: ${result.failed.length}`);
 * ```
 */
export async function fetchAllEnabledCities(
  env: Env,
  options?: {
    /** Resume from checkpoint if available */
    resumeFromCheckpoint?: boolean;
    /** Skip cache and force fresh scrape */
    skipCache?: boolean;
    /** Optional: only process specific cities */
    cityFilter?: string[];
  }
): Promise<MunicipalBatchResult> {
  const result: MunicipalBatchResult = {
    successful: [],
    failed: [],
    skipped: [],
    totalCreditsUsed: 0,
  };

  // Get enabled cities
  let cities = getEnabledCities();

  // Apply city filter if specified
  if (options?.cityFilter && options.cityFilter.length > 0) {
    cities = cities.filter(
      (c) => options.cityFilter!.includes(c.cityId) || options.cityFilter!.includes(c.name)
    );
  }

  // Load checkpoint for resumption
  let checkpoint: MunicipalCheckpoint | null = null;
  let processedCities: string[] = [];

  if (options?.resumeFromCheckpoint) {
    checkpoint = await loadMunicipalCheckpoint(env);
    if (checkpoint) {
      processedCities = [...checkpoint.processedCities];
      console.log(
        `[Municipal] Resuming from checkpoint, ${checkpoint.processedCities.length} cities already processed`
      );
      // Filter out already-processed cities
      cities = cities.filter((c) => !checkpoint!.processedCities.includes(c.cityId));
    }
  }

  console.log(`[Municipal] Processing ${cities.length} cities...`);

  // Process cities sequentially
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    if (!city) continue;

    try {
      console.log(`[Municipal] Processing ${city.name} (${i + 1}/${cities.length})...`);

      const fetchResult = await fetchCity(env, city, { skipCache: options?.skipCache });
      result.successful.push(city.name);
      result.totalCreditsUsed += fetchResult.creditsUsed;

      // Update checkpoint after each successful city
      processedCities.push(city.cityId);
      await saveMunicipalCheckpoint(env, {
        lastProcessedCity: city.cityId,
        processedCities,
        lastUpdated: new Date().toISOString(),
      });

      // Rate limiting delay between cities
      if (i < cities.length - 1) {
        await sleep(CITY_DELAY_MS);
      }
    } catch (error) {
      // Skip and log pattern - continue with next city
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Municipal] FAILED ${city.name}:`, errorMessage);

      result.failed.push({
        city: city.name,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });

      // Continue to next city - don't fail the batch
    }
  }

  console.log(
    `[Municipal] Fetch complete: ${result.successful.length} succeeded, ${result.failed.length} failed`
  );

  return result;
}

/**
 * Fetch a single city by ID or name
 *
 * Convenience wrapper for HTTP endpoint.
 *
 * @param env Cloudflare Workers environment
 * @param cityIdOrName City identifier or display name
 * @param options Fetch options
 * @returns Fetch result with city config and ordinances
 *
 * @example
 * ```typescript
 * const result = await fetchSingleCity(env, 'houston');
 * // or
 * const result = await fetchSingleCity(env, 'Houston');
 * ```
 */
export async function fetchSingleCity(
  env: Env,
  cityIdOrName: string,
  options?: { skipCache?: boolean }
): Promise<{
  city: MunicipalCityConfig;
  ordinances: MunicipalOrdinance[];
  creditsUsed: number;
}> {
  // Try to find city by ID first, then by name
  const city = getCityById(cityIdOrName) ?? getCityByName(cityIdOrName);

  if (!city) {
    throw new Error(`City not found: ${cityIdOrName}`);
  }

  if (!city.enabled) {
    throw new Error(`City is disabled: ${city.name} (${city.skipReason ?? 'no reason given'})`);
  }

  const result = await fetchCity(env, city, options);

  return {
    city,
    ordinances: result.ordinances,
    creditsUsed: result.creditsUsed,
  };
}

/**
 * Get fetch statistics for enabled cities
 *
 * @returns Statistics about enabled cities and their platforms
 */
export function getFetchStats(): {
  totalEnabled: number;
  byPlatform: Record<string, number>;
  cities: string[];
} {
  const enabledCities = getEnabledCities();

  const byPlatform: Record<string, number> = {};
  for (const city of enabledCities) {
    byPlatform[city.platform] = (byPlatform[city.platform] ?? 0) + 1;
  }

  return {
    totalEnabled: enabledCities.length,
    byPlatform,
    cities: enabledCities.map((c) => c.name),
  };
}
