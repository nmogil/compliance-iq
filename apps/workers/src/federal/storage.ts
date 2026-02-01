/**
 * Federal CFR Storage Operations
 *
 * R2 storage functions specific to CFR data, implementing organized folder
 * structure and checkpoint management for pipeline resilience.
 *
 * Folder Structure:
 *   federal/
 *   ├── cfr/
 *   │   ├── title-7/
 *   │   │   ├── part-1.xml
 *   │   │   └── part-2.xml
 *   │   └── title-21/
 *   │       └── part-117.xml
 *   └── checkpoints/
 *       ├── cfr-title-7.json
 *       └── cfr-title-21.json
 */

import { storeDocument, getDocument, listDocuments, deleteDocument } from '../lib/r2';
import type { PipelineCheckpoint } from './types';

/**
 * Store CFR part XML in R2
 *
 * Key pattern: federal/cfr/title-{titleNumber}/part-{partNumber}.xml
 *
 * @param bucket R2 bucket instance
 * @param titleNumber CFR title number
 * @param partNumber CFR part number
 * @param xml Raw XML content from eCFR
 */
export async function storeCFRPart(
  bucket: R2Bucket,
  titleNumber: number,
  partNumber: number,
  xml: string
): Promise<void> {
  const key = `federal/cfr/title-${titleNumber}/part-${partNumber}.xml`;

  await storeDocument(bucket, key, xml, {
    source: 'eCFR',
    dataType: 'raw-regulation',
    titleNumber: String(titleNumber),
    partNumber: String(partNumber),
    fetchedAt: new Date().toISOString(),
  });
}

/**
 * Retrieve CFR part XML from R2
 *
 * @param bucket R2 bucket instance
 * @param titleNumber CFR title number
 * @param partNumber CFR part number
 * @returns XML content, or null if not found
 */
export async function getCFRPart(
  bucket: R2Bucket,
  titleNumber: number,
  partNumber: number
): Promise<string | null> {
  const key = `federal/cfr/title-${titleNumber}/part-${partNumber}.xml`;
  const result = await getDocument(bucket, key);
  return result?.content ?? null;
}

/**
 * List all stored part numbers for a title
 *
 * @param bucket R2 bucket instance
 * @param titleNumber CFR title number
 * @returns Array of part numbers that exist in R2
 */
export async function listCFRParts(
  bucket: R2Bucket,
  titleNumber: number
): Promise<number[]> {
  const prefix = `federal/cfr/title-${titleNumber}/`;
  const documents = await listDocuments(bucket, prefix);

  // Extract part numbers from keys like "federal/cfr/title-7/part-123.xml"
  const partNumbers = documents
    .map((doc) => {
      const match = doc.key.match(/part-(\d+)\.xml$/);
      if (!match || !match[1]) return null;
      return parseInt(match[1], 10);
    })
    .filter((num): num is number => num !== null);

  // Sort numerically
  return partNumbers.sort((a, b) => a - b);
}

/**
 * Save pipeline checkpoint to R2
 *
 * Key pattern: federal/checkpoints/cfr-title-{titleNumber}.json
 *
 * @param bucket R2 bucket instance
 * @param titleNumber CFR title number
 * @param checkpoint Checkpoint state to save
 */
export async function saveCheckpoint(
  bucket: R2Bucket,
  titleNumber: number,
  checkpoint: PipelineCheckpoint
): Promise<void> {
  const key = `federal/checkpoints/cfr-title-${titleNumber}.json`;
  const content = JSON.stringify(checkpoint, null, 2);

  await storeDocument(bucket, key, content, {
    source: 'pipeline',
    dataType: 'checkpoint',
    titleNumber: String(titleNumber),
    fetchedAt: checkpoint.timestamp,
    checkpointStatus: checkpoint.status,
  });
}

/**
 * Load pipeline checkpoint from R2
 *
 * @param bucket R2 bucket instance
 * @param titleNumber CFR title number
 * @returns Checkpoint state, or null if no checkpoint exists (fresh start)
 */
export async function loadCheckpoint(
  bucket: R2Bucket,
  titleNumber: number
): Promise<PipelineCheckpoint | null> {
  const key = `federal/checkpoints/cfr-title-${titleNumber}.json`;
  const result = await getDocument(bucket, key);

  if (!result) {
    return null;
  }

  try {
    return JSON.parse(result.content) as PipelineCheckpoint;
  } catch (error) {
    // If checkpoint is corrupted, treat as no checkpoint
    console.error(`Failed to parse checkpoint for title ${titleNumber}:`, error);
    return null;
  }
}

/**
 * Clear pipeline checkpoint after successful completion
 *
 * @param bucket R2 bucket instance
 * @param titleNumber CFR title number
 */
export async function clearCheckpoint(
  bucket: R2Bucket,
  titleNumber: number
): Promise<void> {
  const key = `federal/checkpoints/cfr-title-${titleNumber}.json`;
  await deleteDocument(bucket, key);
}
