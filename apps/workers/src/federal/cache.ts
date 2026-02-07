/**
 * Federal CFR Cache Management
 *
 * Provides pre-processing and caching of CFR data in R2 to avoid
 * CPU-intensive XML parsing in Cloudflare Workflows.
 *
 * For workflows (which have CPU limits), use './cache-read' directly
 * as it has no XML parsing dependencies.
 *
 * Cache structure:
 *   cache/federal/
 *     manifest.json                  # Global manifest with version, dates
 *     title-7/
 *       manifest.json                # Part list, hashes, last updated
 *       part-1.json                  # Parsed CFRPart (JSON)
 *       part-2.json
 *     title-21/
 *       manifest.json
 *       part-117.json
 */

import type { CFRSection } from './types';
import { fetchCFRTitleStructure, fetchCFRPart, parseCFRXML, fetchCFRTitleList } from './fetch';
import { TARGET_TITLES } from './types';

// Re-export all read functions and types from cache-read
// This allows importing everything from './cache' for convenience
export {
  getCacheManifest,
  getTitleManifest,
  getCachedPart,
  isCacheValid,
  getCacheStatus,
  type CachedCFRPart,
  type TitleManifest,
  type CacheManifest,
} from './cache-read';

// Import for internal use
import {
  getCacheManifest,
  getCachedPart,
  type CachedCFRPart,
  type TitleManifest,
  type CacheManifest,
} from './cache-read';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from refreshing a single title
 */
export interface TitleRefreshResult {
  success: boolean;
  titleNumber: number;
  partsProcessed: number;
  sectionsProcessed: number;
  durationMs: number;
  error?: string;
}

/**
 * Result from refreshing all titles
 */
export interface CacheRefreshResult {
  success: boolean;
  titlesProcessed: number;
  partsProcessed: number;
  sectionsProcessed: number;
  durationMs: number;
  results: TitleRefreshResult[];
  errors: string[];
}

// ============================================================================
// Cache Paths
// ============================================================================

const CACHE_PREFIX = 'cache/federal';

function getCacheManifestPath(): string {
  return `${CACHE_PREFIX}/manifest.json`;
}

function getTitleManifestPath(titleNumber: number): string {
  return `${CACHE_PREFIX}/title-${titleNumber}/manifest.json`;
}

function getPartCachePath(titleNumber: number, partNumber: number): string {
  return `${CACHE_PREFIX}/title-${titleNumber}/part-${partNumber}.json`;
}

// ============================================================================
// Hash Computation
// ============================================================================

/**
 * Compute SHA-256 hash of XML content for change detection
 */
export async function computeXMLHash(xml: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(xml);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Cache Write Functions
// ============================================================================

/**
 * Save the global cache manifest
 */
async function saveCacheManifest(bucket: R2Bucket, manifest: CacheManifest): Promise<void> {
  await bucket.put(getCacheManifestPath(), JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * Save a title's manifest
 */
async function saveTitleManifest(
  bucket: R2Bucket,
  titleNumber: number,
  manifest: TitleManifest
): Promise<void> {
  await bucket.put(getTitleManifestPath(titleNumber), JSON.stringify(manifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * Save a cached part
 */
async function saveCachedPart(
  bucket: R2Bucket,
  titleNumber: number,
  partNumber: number,
  part: CachedCFRPart
): Promise<void> {
  await bucket.put(getPartCachePath(titleNumber, partNumber), JSON.stringify(part, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });
}

/**
 * Update the global manifest with info about a single title
 * Used when refreshing individual titles to keep the global manifest current
 */
async function updateGlobalManifest(
  bucket: R2Bucket,
  titleNumber: number,
  titleName: string,
  partCount: number
): Promise<void> {
  // Get existing manifest or create new one
  let manifest = await getCacheManifest(bucket);
  const now = new Date().toISOString();
  const ecfrDate = now.split('T')[0] as string;

  if (!manifest) {
    manifest = {
      version: '1.0',
      titles: [],
      lastRefresh: now,
      ecfrDate,
    };
  }

  // Update or add this title's entry
  const existingIdx = manifest.titles.findIndex(t => t.titleNumber === titleNumber);
  const titleEntry = {
    titleNumber,
    titleName,
    partCount,
    lastUpdated: now,
  };

  if (existingIdx >= 0) {
    manifest.titles[existingIdx] = titleEntry;
  } else {
    manifest.titles.push(titleEntry);
    // Sort by title number
    manifest.titles.sort((a, b) => a.titleNumber - b.titleNumber);
  }

  manifest.lastRefresh = now;
  manifest.ecfrDate = ecfrDate;

  await saveCacheManifest(bucket, manifest);
}

// ============================================================================
// Cache Refresh Functions
// ============================================================================

/**
 * Refresh cache for a single CFR title
 *
 * Fetches all parts in the title, parses XML, and stores as JSON in R2.
 */
export async function refreshCFRTitle(
  bucket: R2Bucket,
  titleNumber: number
): Promise<TitleRefreshResult> {
  const startTime = Date.now();
  let partsProcessed = 0;
  let sectionsProcessed = 0;

  try {
    console.log(`[Cache] Refreshing cache for title ${titleNumber}`);

    // Get title name from config or API
    const titleConfig = TARGET_TITLES.find(t => t.number === titleNumber);
    let titleName = titleConfig?.name ?? `Title ${titleNumber}`;

    // If not in our config, try to get from API
    if (!titleConfig) {
      try {
        const titles = await fetchCFRTitleList();
        const apiTitle = titles.find(t => t.number === titleNumber);
        if (apiTitle) {
          titleName = apiTitle.name;
        }
      } catch {
        // Ignore - we'll use the fallback name
      }
    }

    // Get title structure (list of parts)
    const structure = await fetchCFRTitleStructure(titleNumber);
    console.log(`[Cache] Title ${titleNumber} has ${structure.parts.length} parts`);

    const ecfrDate = new Date().toISOString().split('T')[0] as string;
    const partManifests: TitleManifest['parts'] = [];

    // Process each part
    for (const partNumber of structure.parts) {
      try {
        console.log(`[Cache] Processing title ${titleNumber} part ${partNumber}`);

        // Fetch XML
        const fetchedAt = new Date().toISOString();
        const xml = await fetchCFRPart(titleNumber, partNumber);

        // Compute hash for change detection
        const xmlHash = await computeXMLHash(xml);

        // Check if we already have this exact version cached
        const existingPart = await getCachedPart(bucket, titleNumber, partNumber);
        if (existingPart && existingPart.metadata.xmlHash === xmlHash) {
          console.log(`[Cache] Part ${partNumber} unchanged (hash match), skipping`);
          partManifests.push({
            partNumber,
            partName: existingPart.partName,
            sectionCount: existingPart.metadata.sectionCount,
            xmlHash,
            cachedAt: existingPart.metadata.parsedAt,
          });
          partsProcessed++;
          sectionsProcessed += existingPart.metadata.sectionCount;
          continue;
        }

        // Parse XML
        const parsedAt = new Date().toISOString();
        const parsed = parseCFRXML(xml);

        // Extract the part (parser returns a pseudo-title with one part)
        const parsedPart = parsed.parts[0];
        if (!parsedPart) {
          console.warn(`[Cache] No part data found in parsed XML for ${titleNumber}/${partNumber}`);
          continue;
        }

        // Convert sections to standard format
        const sections: CFRSection[] = parsedPart.sections.map(s => ({
          number: s.number,
          title: s.heading,
          text: s.text,
          subsections: s.subsections,
          effectiveDate: s.effectiveDate,
          lastAmended: s.lastAmended,
        }));

        // Create cached part
        const cachedPart: CachedCFRPart = {
          titleNumber,
          titleName,
          partNumber: parsedPart.number,
          partName: parsedPart.name,
          sections,
          metadata: {
            fetchedAt,
            parsedAt,
            xmlHash,
            sectionCount: sections.length,
          },
        };

        // Save to R2
        await saveCachedPart(bucket, titleNumber, partNumber, cachedPart);

        partManifests.push({
          partNumber: parsedPart.number,
          partName: parsedPart.name,
          sectionCount: sections.length,
          xmlHash,
          cachedAt: parsedAt,
        });

        partsProcessed++;
        sectionsProcessed += sections.length;

        console.log(`[Cache] Cached part ${partNumber}: ${sections.length} sections`);
      } catch (partError) {
        console.error(`[Cache] Failed to process part ${partNumber}:`, partError);
        // Continue with other parts
      }
    }

    // Save title manifest
    const titleManifest: TitleManifest = {
      titleNumber,
      titleName,
      parts: partManifests,
      lastRefresh: new Date().toISOString(),
      ecfrDate,
    };
    await saveTitleManifest(bucket, titleNumber, titleManifest);

    // Update global manifest with this title's info
    await updateGlobalManifest(bucket, titleNumber, titleName, partsProcessed);

    const durationMs = Date.now() - startTime;
    console.log(
      `[Cache] Title ${titleNumber} refresh complete: ${partsProcessed} parts, ${sectionsProcessed} sections in ${durationMs}ms`
    );

    return {
      success: true,
      titleNumber,
      partsProcessed,
      sectionsProcessed,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Cache] Failed to refresh title ${titleNumber}:`, error);

    return {
      success: false,
      titleNumber,
      partsProcessed,
      sectionsProcessed,
      durationMs,
      error: errorMessage,
    };
  }
}

/**
 * Refresh cache for all target CFR titles
 *
 * Processes each title sequentially to avoid overwhelming the eCFR API.
 */
export async function refreshCFRCache(bucket: R2Bucket): Promise<CacheRefreshResult> {
  const startTime = Date.now();
  const results: TitleRefreshResult[] = [];
  const errors: string[] = [];

  let totalPartsProcessed = 0;
  let totalSectionsProcessed = 0;

  console.log(`[Cache] Starting full cache refresh for ${TARGET_TITLES.length} titles`);

  // Process each enabled title
  for (const titleConfig of TARGET_TITLES) {
    if (!titleConfig.enabled) {
      console.log(`[Cache] Skipping disabled title ${titleConfig.number}`);
      continue;
    }

    const result = await refreshCFRTitle(bucket, titleConfig.number);
    results.push(result);

    if (result.success) {
      totalPartsProcessed += result.partsProcessed;
      totalSectionsProcessed += result.sectionsProcessed;
    } else if (result.error) {
      errors.push(`Title ${titleConfig.number}: ${result.error}`);
    }

    // Small delay between titles to be nice to the API
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Update global manifest
  const ecfrDate = new Date().toISOString().split('T')[0] as string;
  const manifest: CacheManifest = {
    version: '1.0',
    titles: results
      .filter(r => r.success)
      .map(r => ({
        titleNumber: r.titleNumber,
        titleName: TARGET_TITLES.find(t => t.number === r.titleNumber)?.name ?? `Title ${r.titleNumber}`,
        partCount: r.partsProcessed,
        lastUpdated: new Date().toISOString(),
      })),
    lastRefresh: new Date().toISOString(),
    ecfrDate,
  };
  await saveCacheManifest(bucket, manifest);

  const durationMs = Date.now() - startTime;
  const allSuccessful = errors.length === 0;

  console.log(
    `[Cache] Full refresh complete: ${results.filter(r => r.success).length}/${results.length} titles, ` +
    `${totalPartsProcessed} parts, ${totalSectionsProcessed} sections in ${durationMs}ms`
  );

  return {
    success: allSuccessful,
    titlesProcessed: results.filter(r => r.success).length,
    partsProcessed: totalPartsProcessed,
    sectionsProcessed: totalSectionsProcessed,
    durationMs,
    results,
    errors,
  };
}
