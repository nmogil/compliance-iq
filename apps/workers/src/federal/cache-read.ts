/**
 * Federal CFR Cache Reading Functions
 *
 * Lightweight module for reading cached CFR data from R2.
 * This module has NO dependencies on XML parsing, making it safe
 * to use in Cloudflare Workflows without CPU limit issues.
 *
 * For cache refresh operations, use './cache' instead.
 */

import type { CFRSection } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Cached CFR Part - Pre-parsed and ready for chunking
 */
export interface CachedCFRPart {
  titleNumber: number;
  titleName: string;
  partNumber: number;
  partName: string;
  sections: CFRSection[];
  metadata: {
    fetchedAt: string;
    parsedAt: string;
    xmlHash: string;
    sectionCount: number;
  };
}

/**
 * Title-level manifest
 */
export interface TitleManifest {
  titleNumber: number;
  titleName: string;
  parts: {
    partNumber: number;
    partName: string;
    sectionCount: number;
    xmlHash: string;
    cachedAt: string;
  }[];
  lastRefresh: string;
  ecfrDate: string;
}

/**
 * Global cache manifest
 */
export interface CacheManifest {
  version: string;
  titles: {
    titleNumber: number;
    titleName: string;
    partCount: number;
    lastUpdated: string;
  }[];
  lastRefresh: string;
  ecfrDate: string;
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
// Cache Read Functions
// ============================================================================

/**
 * Get the global cache manifest
 */
export async function getCacheManifest(bucket: R2Bucket): Promise<CacheManifest | null> {
  try {
    const obj = await bucket.get(getCacheManifestPath());
    if (!obj) return null;
    const text = await obj.text();
    return JSON.parse(text) as CacheManifest;
  } catch (error) {
    console.error('[Cache] Failed to read cache manifest:', error);
    return null;
  }
}

/**
 * Get a title's manifest
 */
export async function getTitleManifest(
  bucket: R2Bucket,
  titleNumber: number
): Promise<TitleManifest | null> {
  try {
    const obj = await bucket.get(getTitleManifestPath(titleNumber));
    if (!obj) return null;
    const text = await obj.text();
    return JSON.parse(text) as TitleManifest;
  } catch (error) {
    console.error(`[Cache] Failed to read title ${titleNumber} manifest:`, error);
    return null;
  }
}

/**
 * Get a cached part
 */
export async function getCachedPart(
  bucket: R2Bucket,
  titleNumber: number,
  partNumber: number
): Promise<CachedCFRPart | null> {
  try {
    const obj = await bucket.get(getPartCachePath(titleNumber, partNumber));
    if (!obj) return null;
    const text = await obj.text();
    return JSON.parse(text) as CachedCFRPart;
  } catch (error) {
    console.error(`[Cache] Failed to read cached part ${titleNumber}/${partNumber}:`, error);
    return null;
  }
}

/**
 * Check if a cached part is still valid (not stale)
 * @param cachedAt - ISO date string when the part was cached
 * @param maxAgeDays - Maximum age in days (default 7)
 */
export function isCacheValid(cachedAt: string, maxAgeDays = 7): boolean {
  const cachedDate = new Date(cachedAt);
  const now = new Date();
  const ageMs = now.getTime() - cachedDate.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays < maxAgeDays;
}

/**
 * Get cache status summary
 */
export async function getCacheStatus(bucket: R2Bucket): Promise<{
  hasCachedData: boolean;
  manifest: CacheManifest | null;
  freshness: {
    lastRefresh: string | null;
    ageHours: number | null;
    isStale: boolean;
  };
  titles: {
    titleNumber: number;
    titleName: string;
    partCount: number;
    lastUpdated: string;
    isStale: boolean;
  }[];
}> {
  const manifest = await getCacheManifest(bucket);

  if (!manifest) {
    return {
      hasCachedData: false,
      manifest: null,
      freshness: {
        lastRefresh: null,
        ageHours: null,
        isStale: true,
      },
      titles: [],
    };
  }

  const now = new Date();
  const lastRefreshDate = new Date(manifest.lastRefresh);
  const ageMs = now.getTime() - lastRefreshDate.getTime();
  const ageHours = Math.round(ageMs / (1000 * 60 * 60) * 10) / 10;
  const isStale = ageHours > 168; // 7 days

  return {
    hasCachedData: true,
    manifest,
    freshness: {
      lastRefresh: manifest.lastRefresh,
      ageHours,
      isStale,
    },
    titles: manifest.titles.map(t => ({
      ...t,
      isStale: !isCacheValid(t.lastUpdated),
    })),
  };
}
