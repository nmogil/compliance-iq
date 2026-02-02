/**
 * Municipal Ordinance Storage Operations
 *
 * R2 storage functions for municipal ordinances, markdown cache, and checkpoint management.
 * Follows patterns established in counties/storage.ts for consistency.
 *
 * Folder Structure:
 *   municipal/
 *   ├── {cityId}/                      # e.g., houston
 *   │   ├── chapter-{N}/
 *   │   │   └── {section}.json         # Parsed ordinances
 *   │   └── raw/
 *   │       └── page.md                # Raw markdown cache
 *   └── checkpoints/
 *       └── municipal.json             # Pipeline checkpoint
 *
 * Key Patterns:
 * - Ordinance: municipal/{cityId}/chapter-{chapter}/{section}.json
 * - Markdown cache: municipal/{cityId}/raw/page.md
 * - Checkpoint: municipal/checkpoints/municipal.json
 */

import type { MunicipalOrdinance, MunicipalCheckpoint } from './types';

/**
 * Environment bindings for Cloudflare Workers
 */
export interface Env {
  R2_BUCKET: R2Bucket;
}

// ============================================================================
// R2 Key Patterns
// ============================================================================

/**
 * Get R2 key for a parsed ordinance
 */
function getOrdinanceKey(cityId: string, chapter: string, section: string): string {
  return `municipal/${cityId}/chapter-${chapter}/${section}.json`;
}

/**
 * Get R2 key for cached markdown
 */
function getMarkdownCacheKey(cityId: string): string {
  return `municipal/${cityId}/raw/page.md`;
}

/**
 * Get R2 key for pipeline checkpoint
 */
function getCheckpointKey(): string {
  return 'municipal/checkpoints/municipal.json';
}

// ============================================================================
// Ordinance Storage
// ============================================================================

/**
 * Store a parsed municipal ordinance in R2
 *
 * @param env Cloudflare Workers environment
 * @param ordinance Parsed ordinance to store
 *
 * @example
 * ```ts
 * await storeMunicipalOrdinance(env, ordinance);
 * // Stored at: municipal/houston/chapter-1/1-2.json
 * ```
 */
export async function storeMunicipalOrdinance(
  env: Env,
  ordinance: MunicipalOrdinance
): Promise<void> {
  const key = getOrdinanceKey(ordinance.cityId, ordinance.chapter, ordinance.section);

  await env.R2_BUCKET.put(
    key,
    JSON.stringify(ordinance, null, 2),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        cityId: ordinance.cityId,
        chapter: ordinance.chapter,
        section: ordinance.section,
        scrapedAt: ordinance.scrapedAt.toISOString(),
      },
    }
  );
}

/**
 * Retrieve a stored municipal ordinance from R2
 *
 * @param env Cloudflare Workers environment
 * @param cityId City identifier (e.g., "houston")
 * @param chapter Chapter number
 * @param section Section number
 * @returns Parsed ordinance or null if not found
 *
 * @example
 * ```ts
 * const ordinance = await getMunicipalOrdinance(env, 'houston', '1', '1-2');
 * // Returns MunicipalOrdinance or null
 * ```
 */
export async function getMunicipalOrdinance(
  env: Env,
  cityId: string,
  chapter: string,
  section: string
): Promise<MunicipalOrdinance | null> {
  const key = getOrdinanceKey(cityId, chapter, section);
  const object = await env.R2_BUCKET.get(key);

  if (!object) return null;

  const text = await object.text();
  const data = JSON.parse(text);

  // Restore Date object
  return {
    ...data,
    scrapedAt: new Date(data.scrapedAt),
  };
}

/**
 * List all ordinance sections for a city
 *
 * @param env Cloudflare Workers environment
 * @param cityId City identifier
 * @returns Array of section identifiers
 *
 * @example
 * ```ts
 * const sections = await listMunicipalOrdinances(env, 'houston');
 * // Returns ['1-1', '1-2', '1-3', ...]
 * ```
 */
export async function listMunicipalOrdinances(
  env: Env,
  cityId: string
): Promise<string[]> {
  const prefix = `municipal/${cityId}/chapter-`;
  const listed = await env.R2_BUCKET.list({ prefix });

  const sections: string[] = [];
  for (const obj of listed.objects) {
    // Extract section from key: municipal/houston/chapter-1/1-2.json -> 1-2
    const match = obj.key.match(/chapter-[\d]+\/([\d.-]+)\.json$/);
    if (match?.[1]) {
      sections.push(match[1]);
    }
    // Skip keys that don't match the expected pattern
  }
  return sections;
}

/**
 * Store multiple ordinances for a city
 *
 * @param env Cloudflare Workers environment
 * @param ordinances Array of ordinances to store
 * @returns Number of ordinances stored
 *
 * @example
 * ```ts
 * const count = await storeMunicipalOrdinances(env, ordinances);
 * console.log(`Stored ${count} ordinances`);
 * ```
 */
export async function storeMunicipalOrdinances(
  env: Env,
  ordinances: MunicipalOrdinance[]
): Promise<number> {
  let stored = 0;
  for (const ordinance of ordinances) {
    await storeMunicipalOrdinance(env, ordinance);
    stored++;
  }
  return stored;
}

// ============================================================================
// Markdown Cache (for Firecrawl cost optimization)
// ============================================================================

/**
 * Store raw markdown from Firecrawl to avoid redundant API calls
 *
 * Per 05-RESEARCH.md pitfall #1: Cache raw markdown in R2 to minimize Firecrawl credits.
 *
 * @param env Cloudflare Workers environment
 * @param cityId City identifier
 * @param markdown Raw markdown content from Firecrawl
 * @param metadata Scrape metadata
 *
 * @example
 * ```ts
 * await storeMunicipalMarkdown(env, 'houston', markdown, {
 *   title: 'Houston Code of Ordinances',
 *   sourceUrl: 'https://library.municode.com/tx/houston/codes/code_of_ordinances',
 *   scrapedAt: new Date()
 * });
 * ```
 */
export async function storeMunicipalMarkdown(
  env: Env,
  cityId: string,
  markdown: string,
  metadata: { title: string; sourceUrl: string; scrapedAt: Date }
): Promise<void> {
  const key = getMarkdownCacheKey(cityId);

  await env.R2_BUCKET.put(
    key,
    markdown,
    {
      httpMetadata: { contentType: 'text/markdown' },
      customMetadata: {
        cityId,
        title: metadata.title,
        sourceUrl: metadata.sourceUrl,
        scrapedAt: metadata.scrapedAt.toISOString(),
      },
    }
  );
}

/**
 * Retrieve cached markdown for a city
 *
 * @param env Cloudflare Workers environment
 * @param cityId City identifier
 * @param maxAgeMs Maximum cache age in milliseconds (optional)
 * @returns Cached markdown or null if not found/expired
 *
 * @example
 * ```ts
 * // Get cached markdown if less than 7 days old
 * const cached = await getMunicipalMarkdown(env, 'houston', 7 * 24 * 60 * 60 * 1000);
 * if (cached) {
 *   console.log(`Using cached markdown from ${cached.scrapedAt}`);
 * }
 * ```
 */
export async function getMunicipalMarkdown(
  env: Env,
  cityId: string,
  maxAgeMs?: number
): Promise<{ markdown: string; scrapedAt: Date } | null> {
  const key = getMarkdownCacheKey(cityId);
  const object = await env.R2_BUCKET.get(key);

  if (!object) return null;

  // Check age if maxAgeMs specified
  const metadataScrapedAt = object.customMetadata?.['scrapedAt'];
  if (maxAgeMs && metadataScrapedAt) {
    const scrapedAt = new Date(metadataScrapedAt);
    const age = Date.now() - scrapedAt.getTime();
    if (age > maxAgeMs) {
      console.log(`[Municipal] Markdown cache expired for ${cityId} (${Math.round(age / 86400000)} days old)`);
      return null;
    }
  }

  const markdown = await object.text();
  const scrapedAt = metadataScrapedAt
    ? new Date(metadataScrapedAt)
    : new Date();

  return { markdown, scrapedAt };
}

// ============================================================================
// Checkpoint Management
// ============================================================================

/**
 * Save pipeline checkpoint for resumption
 *
 * Single checkpoint for all municipal processing (unlike per-source county pattern).
 *
 * @param env Cloudflare Workers environment
 * @param checkpoint Checkpoint state to save
 *
 * @example
 * ```ts
 * await saveMunicipalCheckpoint(env, {
 *   lastProcessedCity: 'houston',
 *   processedCities: ['austin', 'dallas'],
 *   lastUpdated: new Date().toISOString()
 * });
 * ```
 */
export async function saveMunicipalCheckpoint(
  env: Env,
  checkpoint: MunicipalCheckpoint
): Promise<void> {
  const key = getCheckpointKey();

  await env.R2_BUCKET.put(
    key,
    JSON.stringify(checkpoint, null, 2),
    {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        lastUpdated: checkpoint.lastUpdated,
        processedCount: checkpoint.processedCities.length.toString(),
      },
    }
  );
}

/**
 * Load pipeline checkpoint
 *
 * @param env Cloudflare Workers environment
 * @returns Checkpoint or null if fresh start
 *
 * @example
 * ```ts
 * const checkpoint = await loadMunicipalCheckpoint(env);
 * if (checkpoint) {
 *   console.log(`Resuming from ${checkpoint.lastProcessedCity}`);
 * } else {
 *   console.log('Starting fresh pipeline run');
 * }
 * ```
 */
export async function loadMunicipalCheckpoint(
  env: Env
): Promise<MunicipalCheckpoint | null> {
  const key = getCheckpointKey();
  const object = await env.R2_BUCKET.get(key);

  if (!object) return null;

  const text = await object.text();
  return JSON.parse(text);
}

/**
 * Clear checkpoint for fresh pipeline run
 *
 * @param env Cloudflare Workers environment
 *
 * @example
 * ```ts
 * // After successful pipeline completion
 * await clearMunicipalCheckpoint(env);
 * ```
 */
export async function clearMunicipalCheckpoint(env: Env): Promise<void> {
  const key = getCheckpointKey();
  await env.R2_BUCKET.delete(key);
}

// ============================================================================
// Storage Statistics
// ============================================================================

/**
 * Get storage statistics for monitoring
 *
 * @param env Cloudflare Workers environment
 * @returns Storage statistics
 *
 * @example
 * ```ts
 * const stats = await getMunicipalStorageStats(env);
 * console.log(`${stats.totalOrdinances} ordinances across ${stats.citiesWithData.length} cities`);
 * ```
 */
export async function getMunicipalStorageStats(
  env: Env
): Promise<{
  totalOrdinances: number;
  citiesWithData: string[];
  markdownCacheCount: number;
  checkpointExists: boolean;
}> {
  // Count ordinances
  const ordinanceList = await env.R2_BUCKET.list({ prefix: 'municipal/' });
  const ordinances = ordinanceList.objects.filter(o => o.key.endsWith('.json') && !o.key.includes('checkpoints'));

  // Extract unique city IDs
  const cities = new Set<string>();
  for (const obj of ordinances) {
    const match = obj.key.match(/^municipal\/([^/]+)\//);
    if (match) {
      const cityId = match[1];
      if (cityId && cityId !== 'checkpoints') {
        cities.add(cityId);
      }
    }
  }

  // Count markdown caches
  const markdownList = await env.R2_BUCKET.list({ prefix: 'municipal/' });
  const markdownCaches = markdownList.objects.filter(o => o.key.endsWith('/raw/page.md'));

  // Check checkpoint
  const checkpoint = await env.R2_BUCKET.get(getCheckpointKey());

  return {
    totalOrdinances: ordinances.length,
    citiesWithData: Array.from(cities),
    markdownCacheCount: markdownCaches.length,
    checkpointExists: checkpoint !== null,
  };
}
