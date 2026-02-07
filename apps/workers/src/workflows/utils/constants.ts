/**
 * Workflow Constants
 *
 * Lightweight constants file with no heavy dependencies.
 * Use this in workflows to avoid CPU limit issues from SDK imports.
 */

/** Batch size for OpenAI embeddings (recommended: 64) */
export const EMBED_BATCH_SIZE = 64;

/** Batch size for Pinecone upserts (recommended: 100) */
export const UPSERT_BATCH_SIZE = 100;

/** Delay between embedding batches (ms) */
export const EMBED_BATCH_DELAY = 100;

/**
 * Calculate number of embedding batches needed
 */
export function getEmbedBatchCount(chunkCount: number): number {
  return Math.ceil(chunkCount / EMBED_BATCH_SIZE);
}

/**
 * Calculate number of upsert batches needed
 */
export function getUpsertBatchCount(chunkCount: number): number {
  return Math.ceil(chunkCount / UPSERT_BATCH_SIZE);
}
