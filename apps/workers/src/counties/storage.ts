/**
 * County Ordinance Storage Operations
 *
 * R2 storage functions for county ordinances and checkpoint management.
 * Follows patterns established in texas/storage.ts for consistency.
 *
 * Folder Structure:
 *   counties/
 *   ├── {fips-code}/              # e.g., 48201 for Harris County
 *   │   ├── chapter-{N}/
 *   │   │   └── {section}.html
 *   │   └── ...
 *   └── checkpoints/
 *       └── county.json
 *
 * Key Patterns:
 * - Ordinance: counties/{fipsCode}/chapter-{chapter}/{section}.html
 * - Checkpoint: counties/checkpoints/county.json
 */

import { storeDocument, getDocument, listDocuments, deleteDocument } from '../lib/r2';
import type { CountyCheckpoint, CountyOrdinance } from './types';

/**
 * Store county ordinance HTML in R2
 *
 * Key pattern: counties/{fipsCode}/chapter-{chapter}/{section}.html
 *
 * @param bucket R2 bucket instance
 * @param ordinance County ordinance metadata
 * @param html Raw HTML content from county source
 *
 * @example
 * ```ts
 * await storeCountyOrdinance(bucket, ordinance, html);
 * // Stored at: counties/48201/chapter-1/1.02.html
 * ```
 */
export async function storeCountyOrdinance(
  bucket: R2Bucket,
  ordinance: CountyOrdinance,
  html: string
): Promise<void> {
  const key = `counties/${ordinance.fipsCode}/chapter-${ordinance.chapter}/${ordinance.section}.html`;

  await storeDocument(bucket, key, html, {
    source: ordinance.sourceUrl,
    dataType: 'raw-ordinance',
    county: ordinance.county,
    fipsCode: ordinance.fipsCode,
    chapter: ordinance.chapter,
    section: ordinance.section,
    heading: ordinance.heading,
    fetchedAt: ordinance.scrapedAt,
  });
}

/**
 * Retrieve county ordinance HTML from R2
 *
 * @param bucket R2 bucket instance
 * @param fipsCode County FIPS code (e.g., "48201")
 * @param chapter Chapter number
 * @param section Section number
 * @returns HTML content, or null if not found
 *
 * @example
 * ```ts
 * const html = await getCountyOrdinance(bucket, '48201', '1', '1.02');
 * // Returns HTML content or null
 * ```
 */
export async function getCountyOrdinance(
  bucket: R2Bucket,
  fipsCode: string,
  chapter: string,
  section: string
): Promise<string | null> {
  const key = `counties/${fipsCode}/chapter-${chapter}/${section}.html`;
  const result = await getDocument(bucket, key);
  return result?.content ?? null;
}

/**
 * List stored ordinance sections for a county
 *
 * @param bucket R2 bucket instance
 * @param fipsCode County FIPS code (e.g., "48201")
 * @param chapter Optional chapter number to filter by
 * @returns Array of section identifiers (e.g., ["1.02", "1.03"])
 *
 * @example
 * ```ts
 * // List all sections for Harris County
 * const sections = await listCountyOrdinances(bucket, '48201');
 *
 * // List sections in chapter 1 only
 * const chapter1 = await listCountyOrdinances(bucket, '48201', '1');
 * ```
 */
export async function listCountyOrdinances(
  bucket: R2Bucket,
  fipsCode: string,
  chapter?: string
): Promise<string[]> {
  const prefix = chapter
    ? `counties/${fipsCode}/chapter-${chapter}/`
    : `counties/${fipsCode}/`;

  const documents = await listDocuments(bucket, prefix);

  // Extract section identifiers from keys like "counties/48201/chapter-1/1.02.html"
  const sections = documents
    .map((doc) => {
      const match = doc.key.match(/\/([^/]+)\.html$/);
      if (!match || !match[1]) return null;
      return match[1];
    })
    .filter((section): section is string => section !== null);

  // Sort by numeric value for proper ordering (1, 2, 10 not 1, 10, 2)
  return sections.sort((a, b) => {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });
}

/**
 * Save county pipeline checkpoint to R2
 *
 * Key pattern: counties/checkpoints/county.json
 *
 * Checkpoints enable pipeline resumption after failures or rate limiting.
 * The checkpoint tracks the last successfully processed county and section.
 *
 * @param bucket R2 bucket instance
 * @param checkpoint Checkpoint state to save
 *
 * @example
 * ```ts
 * await saveCountyCheckpoint(bucket, {
 *   sourceType: 'county',
 *   lastProcessedCounty: 'Harris',
 *   lastProcessedSection: '1.05',
 *   timestamp: new Date().toISOString(),
 *   chunksProcessed: 150,
 *   status: 'in_progress'
 * });
 * ```
 */
export async function saveCountyCheckpoint(
  bucket: R2Bucket,
  checkpoint: CountyCheckpoint
): Promise<void> {
  const key = 'counties/checkpoints/county.json';
  const content = JSON.stringify(checkpoint, null, 2);

  await storeDocument(bucket, key, content, {
    source: 'pipeline',
    dataType: 'checkpoint',
    sourceType: checkpoint.sourceType,
    fetchedAt: checkpoint.timestamp,
    checkpointStatus: checkpoint.status,
  });
}

/**
 * Load county pipeline checkpoint from R2
 *
 * @param bucket R2 bucket instance
 * @returns Checkpoint state, or null if no checkpoint exists (fresh start)
 *
 * @example
 * ```ts
 * const checkpoint = await loadCountyCheckpoint(bucket);
 * if (checkpoint) {
 *   console.log(`Resuming from ${checkpoint.lastProcessedCounty}`);
 * } else {
 *   console.log('Starting fresh pipeline run');
 * }
 * ```
 */
export async function loadCountyCheckpoint(
  bucket: R2Bucket
): Promise<CountyCheckpoint | null> {
  const key = 'counties/checkpoints/county.json';
  const result = await getDocument(bucket, key);

  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result.content) as CountyCheckpoint;
  } catch (error) {
    // If checkpoint is corrupted, treat as no checkpoint
    console.error('[CountyStorage] Failed to parse checkpoint:', error);
    return null;
  }
}

/**
 * Clear county pipeline checkpoint after successful completion
 *
 * Call this after the pipeline completes successfully to ensure
 * the next run starts fresh.
 *
 * @param bucket R2 bucket instance
 *
 * @example
 * ```ts
 * // After successful pipeline completion
 * await clearCountyCheckpoint(bucket);
 * ```
 */
export async function clearCountyCheckpoint(bucket: R2Bucket): Promise<void> {
  const key = 'counties/checkpoints/county.json';
  await deleteDocument(bucket, key);
}

/**
 * Get storage statistics for a county
 *
 * @param bucket R2 bucket instance
 * @param fipsCode County FIPS code
 * @returns Storage statistics (sections stored, total size, chapters)
 *
 * @example
 * ```ts
 * const stats = await getCountyStorageStats(bucket, '48201');
 * console.log(`Harris County: ${stats.sections} sections, ${stats.chapters} chapters`);
 * ```
 */
export async function getCountyStorageStats(
  bucket: R2Bucket,
  fipsCode: string
): Promise<{
  sections: number;
  totalSize: number;
  chapters: Set<string>;
}> {
  const prefix = `counties/${fipsCode}/`;
  const documents = await listDocuments(bucket, prefix);

  const chapters = new Set<string>();
  let totalSize = 0;

  for (const doc of documents) {
    totalSize += doc.size;

    // Extract chapter from key like "counties/48201/chapter-1/1.02.html"
    const chapterMatch = doc.key.match(/chapter-([^/]+)/);
    if (chapterMatch?.[1]) {
      chapters.add(chapterMatch[1]);
    }
  }

  return {
    sections: documents.length,
    totalSize,
    chapters,
  };
}
