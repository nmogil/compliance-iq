/**
 * Municipal Code Scraper
 *
 * Firecrawl-based scraper for JavaScript-rendered municipal code sites.
 * Handles both Municode (React SPA) and American Legal (server-rendered)
 * platforms with unified markdown output.
 *
 * Key Features:
 * - Firecrawl SDK for JavaScript rendering and anti-bot handling
 * - Platform-specific waitFor configuration
 * - Detailed error logging for debugging failed scrapes
 * - Rate limiting between requests
 *
 * @example
 * ```typescript
 * const result = await scrapeCity(env, city);
 * // Returns { markdown, metadata } or throws on failure
 * ```
 */

import Firecrawl from '@mendable/firecrawl-js';
import type { MunicipalCityConfig, MunicipalBatchResult } from './types';
import { getEnabledCities, getSkippedCities } from './cities';
import {
  storeMunicipalMarkdown,
  getMunicipalMarkdown,
  type Env,
} from './storage';

// Re-export Env for convenience
export type { Env } from './storage';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from a successful Firecrawl scrape
 */
export interface FirecrawlScrapeResult {
  /** Markdown content from the page */
  markdown: string;
  /** Scrape metadata */
  metadata: {
    title: string;
    sourceUrl: string;
    statusCode: number;
    creditsUsed: number;
    scrapedAt: Date;
  };
}

/**
 * Error class for Firecrawl-specific failures
 */
export class FirecrawlError extends Error {
  /** City that failed */
  city: string;
  /** Platform (municode | amlegal) */
  platform: string;
  /** Original error message */
  originalError?: string;
  /** HTTP status code if available */
  statusCode?: number;

  constructor(
    message: string,
    city: string,
    platform: string,
    originalError?: string,
    statusCode?: number
  ) {
    super(message);
    this.name = 'FirecrawlError';
    this.city = city;
    this.platform = platform;
    this.originalError = originalError;
    this.statusCode = statusCode;
  }
}

// ============================================================================
// Core Scraping Functions
// ============================================================================

/**
 * Scrape a municipal code page using Firecrawl
 *
 * Uses Firecrawl SDK to handle JavaScript rendering, proxy rotation,
 * and anti-bot protection. Returns markdown for downstream parsing.
 *
 * @param apiKey Firecrawl API key
 * @param city City configuration with URL and waitFor settings
 * @returns Scrape result with markdown and metadata
 *
 * @example
 * ```typescript
 * const result = await scrapeMunicipalCode(apiKey, houston);
 * console.log(result.markdown); // Full page as markdown
 * console.log(result.metadata.creditsUsed); // API credits consumed
 * ```
 */
export async function scrapeMunicipalCode(
  apiKey: string,
  city: MunicipalCityConfig
): Promise<FirecrawlScrapeResult> {
  const app = new Firecrawl({ apiKey });

  // Get platform-specific configuration
  const waitFor = city.firecrawlConfig?.waitFor ?? (city.platform === 'municode' ? 2000 : 1000);
  const onlyMainContent = city.firecrawlConfig?.onlyMainContent ?? true;

  console.log(`[Municipal] Scraping ${city.name} (${city.platform}, waitFor=${waitFor}ms)...`);

  try {
    const result = await app.scrape(city.baseUrl, {
      formats: ['markdown'],
      onlyMainContent,
      waitFor,
      timeout: 60000, // 60s timeout for slow-loading SPAs
    });

    // Validate we got markdown content
    if (!result.markdown || result.markdown.trim().length === 0) {
      throw new FirecrawlError(
        `Empty markdown returned for ${city.name}`,
        city.name,
        city.platform,
        'Markdown content is empty or whitespace-only'
      );
    }

    console.log(`[Municipal] Successfully scraped ${city.name} (${result.markdown.length} chars)`);

    return {
      markdown: result.markdown,
      metadata: {
        title: result.metadata?.title || city.name,
        sourceUrl: result.metadata?.sourceURL || city.baseUrl,
        statusCode: result.metadata?.statusCode || 200,
        creditsUsed: 1, // Standard scrape = 1 credit
        scrapedAt: new Date(),
      },
    };
  } catch (error) {
    // Wrap non-FirecrawlError exceptions with context
    if (error instanceof FirecrawlError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    // Check for rate limit errors
    if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
      throw new FirecrawlError(
        `Firecrawl rate limit exceeded for ${city.name}`,
        city.name,
        city.platform,
        message,
        429
      );
    }

    // Check for authentication errors
    if (message.includes('401') || message.includes('403') || message.toLowerCase().includes('unauthorized')) {
      throw new FirecrawlError(
        `Firecrawl authentication failed for ${city.name}`,
        city.name,
        city.platform,
        message,
        401
      );
    }

    throw new FirecrawlError(
      `Firecrawl scrape failed for ${city.name}: ${message}`,
      city.name,
      city.platform,
      message
    );
  }
}

/**
 * Scrape a city with caching and error handling
 *
 * High-level function that:
 * 1. Checks R2 cache for fresh markdown
 * 2. Scrapes via Firecrawl if cache miss/expired
 * 3. Stores result in R2 cache
 * 4. Returns markdown for parsing
 *
 * @param env Workers environment with R2 bucket
 * @param city City configuration
 * @param options Scrape options
 * @returns Scrape result with markdown and metadata
 *
 * @example
 * ```typescript
 * // Use cached markdown if less than 7 days old
 * const result = await scrapeCity(env, houston, { maxCacheAgeMs: 7 * 24 * 60 * 60 * 1000 });
 * ```
 */
export async function scrapeCity(
  env: Env & { FIRECRAWL_API_KEY: string },
  city: MunicipalCityConfig,
  options: {
    /** Maximum cache age in milliseconds (default: 30 days) */
    maxCacheAgeMs?: number;
    /** Force fresh scrape (ignore cache) */
    forceRefresh?: boolean;
  } = {}
): Promise<FirecrawlScrapeResult> {
  const {
    maxCacheAgeMs = 30 * 24 * 60 * 60 * 1000, // 30 days default
    forceRefresh = false,
  } = options;

  // Check cache unless forcing refresh
  if (!forceRefresh) {
    const cached = await getMunicipalMarkdown(env, city.cityId, maxCacheAgeMs);
    if (cached) {
      console.log(`[Municipal] Using cached markdown for ${city.name} (scraped ${cached.scrapedAt.toISOString()})`);
      return {
        markdown: cached.markdown,
        metadata: {
          title: city.name,
          sourceUrl: city.baseUrl,
          statusCode: 200,
          creditsUsed: 0, // No API credit used for cached content
          scrapedAt: cached.scrapedAt,
        },
      };
    }
  }

  // Scrape via Firecrawl
  const result = await scrapeMunicipalCode(env.FIRECRAWL_API_KEY, city);

  // Cache the markdown in R2
  await storeMunicipalMarkdown(env, city.cityId, result.markdown, {
    title: result.metadata.title,
    sourceUrl: result.metadata.sourceUrl,
    scrapedAt: result.metadata.scrapedAt,
  });

  return result;
}

/**
 * Sleep utility for rate limiting between cities
 *
 * @param ms Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Batch Scraping
// ============================================================================

/**
 * Scrape all enabled cities with skip-and-log error handling
 *
 * Processes cities sequentially with delays to avoid rate limits.
 * Continues processing on individual failures (skip-and-log pattern).
 *
 * @param env Workers environment
 * @param options Batch options
 * @returns Batch result with successful/failed/skipped cities
 *
 * @example
 * ```typescript
 * const result = await scrapeAllCities(env, { delayBetweenCitiesMs: 2000 });
 * console.log(`Processed ${result.successful.length} cities`);
 * console.log(`Failed: ${result.failed.map(f => f.city).join(', ')}`);
 * ```
 */
export async function scrapeAllCities(
  env: Env & { FIRECRAWL_API_KEY: string },
  options: {
    /** Delay between cities in milliseconds (default: 2000) */
    delayBetweenCitiesMs?: number;
    /** Maximum cache age in milliseconds (default: 30 days) */
    maxCacheAgeMs?: number;
    /** Force fresh scrape for all cities */
    forceRefresh?: boolean;
  } = {}
): Promise<MunicipalBatchResult> {
  const {
    delayBetweenCitiesMs = 2000,
    maxCacheAgeMs = 30 * 24 * 60 * 60 * 1000,
    forceRefresh = false,
  } = options;

  const result: MunicipalBatchResult = {
    successful: [],
    failed: [],
    skipped: [],
    totalCreditsUsed: 0,
  };

  // Track skipped cities
  const skipped = getSkippedCities();
  result.skipped = skipped.map((c) => c.name);

  // Process enabled cities
  const cities = getEnabledCities();
  console.log(`[Municipal] Starting batch scrape of ${cities.length} cities...`);

  for (const [i, city] of cities.entries()) {
    try {
      console.log(`[Municipal] Processing ${city.name} (${i + 1}/${cities.length})...`);

      const scrapeResult = await scrapeCity(env, city, {
        maxCacheAgeMs,
        forceRefresh,
      });

      result.successful.push(city.name);
      result.totalCreditsUsed += scrapeResult.metadata.creditsUsed;

      // Delay between cities (skip after last city)
      if (i < cities.length - 1) {
        await sleep(delayBetweenCitiesMs);
      }
    } catch (error) {
      // Log detailed error for debugging
      if (error instanceof FirecrawlError) {
        console.error(`[Municipal] Failed to scrape ${city.name}:`, {
          message: error.message,
          platform: error.platform,
          originalError: error.originalError,
          statusCode: error.statusCode,
        });
      } else {
        console.error(`[Municipal] Failed to scrape ${city.name}:`, error);
      }

      result.failed.push({
        city: city.name,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });

      // Continue with next city (skip-and-log pattern)
    }
  }

  console.log(`[Municipal] Batch scrape complete: ${result.successful.length} successful, ${result.failed.length} failed, ${result.skipped.length} skipped`);
  console.log(`[Municipal] Total Firecrawl credits used: ${result.totalCreditsUsed}`);

  return result;
}
