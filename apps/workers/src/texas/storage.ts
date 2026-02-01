/**
 * Texas State Data Storage Operations
 *
 * R2 storage functions for Texas Statutes and TAC data, implementing
 * organized folder structure and checkpoint management.
 *
 * Folder Structure:
 *   texas/
 *   ├── statutes/
 *   │   ├── PE/                    # Penal Code
 *   │   │   ├── chapter-30/
 *   │   │   │   └── 30.02.html
 *   │   │   └── chapter-31/
 *   │   └── HS/                    # Health & Safety Code
 *   │       └── chapter-1/
 *   ├── tac/
 *   │   ├── title-16/
 *   │   │   └── chapter-5.html
 *   │   └── title-22/
 *   └── checkpoints/
 *       ├── statute.json
 *       └── tac.json
 */

import { storeDocument, getDocument, listDocuments, deleteDocument } from '../lib/r2';
import type { TexasCheckpoint, TexasStatuteSection, TACRule } from './types';

/**
 * Store Texas statute section HTML in R2
 *
 * Key pattern: texas/statutes/{code}/chapter-{chapter}/{section}.html
 *
 * @param bucket R2 bucket instance
 * @param section Texas statute section metadata
 * @param html Raw HTML content from capitol.texas.gov
 */
export async function storeTexasStatute(
  bucket: R2Bucket,
  section: TexasStatuteSection,
  html: string
): Promise<void> {
  const key = `texas/statutes/${section.code}/chapter-${section.chapter}/${section.section}.html`;

  await storeDocument(bucket, key, html, {
    source: 'capitol.texas.gov',
    dataType: 'raw-statute',
    code: section.code,
    chapter: section.chapter,
    section: section.section,
    fetchedAt: section.scrapedAt,
  });
}

/**
 * Retrieve Texas statute section HTML from R2
 *
 * @param bucket R2 bucket instance
 * @param code Texas code abbreviation (e.g., "PE", "HS")
 * @param chapter Chapter number
 * @param section Section number
 * @returns HTML content, or null if not found
 */
export async function getTexasStatute(
  bucket: R2Bucket,
  code: string,
  chapter: string,
  section: string
): Promise<string | null> {
  const key = `texas/statutes/${code}/chapter-${chapter}/${section}.html`;
  const result = await getDocument(bucket, key);
  return result?.content ?? null;
}

/**
 * List all stored statute sections for a code (optionally filtered by chapter)
 *
 * @param bucket R2 bucket instance
 * @param code Texas code abbreviation (e.g., "PE")
 * @param chapter Optional chapter number to filter by
 * @returns Array of section identifiers (e.g., ["30.02", "30.03"])
 */
export async function listTexasStatuteSections(
  bucket: R2Bucket,
  code: string,
  chapter?: string
): Promise<string[]> {
  const prefix = chapter
    ? `texas/statutes/${code}/chapter-${chapter}/`
    : `texas/statutes/${code}/`;
  const documents = await listDocuments(bucket, prefix);

  // Extract section identifiers from keys like "texas/statutes/PE/chapter-30/30.02.html"
  const sections = documents
    .map((doc) => {
      const match = doc.key.match(/\/([^/]+)\.html$/);
      if (!match || !match[1]) return null;
      return match[1];
    })
    .filter((section): section is string => section !== null);

  // Sort by numeric value for proper ordering
  return sections.sort((a, b) => {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    return numA - numB;
  });
}

/**
 * Save Texas pipeline checkpoint to R2
 *
 * Key pattern: texas/checkpoints/{sourceType}.json
 *
 * @param bucket R2 bucket instance
 * @param checkpoint Checkpoint state to save
 */
export async function saveTexasCheckpoint(
  bucket: R2Bucket,
  checkpoint: TexasCheckpoint
): Promise<void> {
  const key = `texas/checkpoints/${checkpoint.sourceType}.json`;
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
 * Load Texas pipeline checkpoint from R2
 *
 * @param bucket R2 bucket instance
 * @param sourceType Source type ('statute' or 'tac')
 * @returns Checkpoint state, or null if no checkpoint exists (fresh start)
 */
export async function loadTexasCheckpoint(
  bucket: R2Bucket,
  sourceType: 'statute' | 'tac'
): Promise<TexasCheckpoint | null> {
  const key = `texas/checkpoints/${sourceType}.json`;
  const result = await getDocument(bucket, key);

  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result.content) as TexasCheckpoint;
  } catch (error) {
    // If checkpoint is corrupted, treat as no checkpoint
    console.error(`Failed to parse Texas checkpoint for ${sourceType}:`, error);
    return null;
  }
}

/**
 * Clear Texas pipeline checkpoint after successful completion
 *
 * @param bucket R2 bucket instance
 * @param sourceType Source type ('statute' or 'tac')
 */
export async function clearTexasCheckpoint(
  bucket: R2Bucket,
  sourceType: 'statute' | 'tac'
): Promise<void> {
  const key = `texas/checkpoints/${sourceType}.json`;
  await deleteDocument(bucket, key);
}

/**
 * Store TAC rule HTML in R2
 *
 * Key pattern: texas/tac/title-{title}/chapter-{chapter}/{section}.html
 *
 * @param bucket R2 bucket instance
 * @param rule TAC rule metadata
 * @param html Raw HTML content from sos.state.tx.us
 */
export async function storeTACRule(
  bucket: R2Bucket,
  rule: TACRule,
  html: string
): Promise<void> {
  const key = `texas/tac/title-${rule.title}/chapter-${rule.chapter}/${rule.section}.html`;

  await storeDocument(bucket, key, html, {
    source: 'sos.state.tx.us',
    dataType: 'raw-tac',
    title: String(rule.title),
    chapter: rule.chapter,
    section: rule.section,
    fetchedAt: rule.scrapedAt,
  });
}

/**
 * Retrieve TAC rule HTML from R2
 *
 * @param bucket R2 bucket instance
 * @param title TAC title number
 * @param chapter Chapter number
 * @param section Section number
 * @returns HTML content, or null if not found
 */
export async function getTACRule(
  bucket: R2Bucket,
  title: number,
  chapter: string,
  section: string
): Promise<string | null> {
  const key = `texas/tac/title-${title}/chapter-${chapter}/${section}.html`;
  const result = await getDocument(bucket, key);
  return result?.content ?? null;
}
