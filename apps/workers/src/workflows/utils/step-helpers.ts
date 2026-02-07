/**
 * Workflow Step Helpers
 *
 * Reusable step implementations for embedding and upserting batches.
 * These helpers work with R2 for state management to stay under the
 * 1 MiB step return limit.
 */

import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import type { StoredChunks, StoredEmbeddings } from '../types';
import type { ChunkMetadata } from '../../pinecone';

// ============================================================================
// Constants
// ============================================================================

/** Batch size for OpenAI embeddings (recommended: 64) */
export const EMBED_BATCH_SIZE = 64;

/** Batch size for Pinecone upserts (recommended: 100) */
export const UPSERT_BATCH_SIZE = 100;

/** Delay between embedding batches (ms) */
export const EMBED_BATCH_DELAY = 100;

// ============================================================================
// R2 State Management
// ============================================================================

/**
 * Generate R2 key for workflow state
 */
export function getStateKey(instanceId: string, type: string): string {
  return `workflows/${instanceId}/${type}.json`;
}

/**
 * Store chunks in R2 for later embedding
 */
export async function storeChunks(
  bucket: R2Bucket,
  instanceId: string,
  chunks: StoredChunks['chunks']
): Promise<string> {
  const key = getStateKey(instanceId, 'chunks');
  const data: StoredChunks = { chunks, count: chunks.length };
  await bucket.put(key, JSON.stringify(data));
  return key;
}

/**
 * Load chunks from R2
 */
export async function loadChunks(
  bucket: R2Bucket,
  instanceId: string
): Promise<StoredChunks> {
  const key = getStateKey(instanceId, 'chunks');
  const obj = await bucket.get(key);
  if (!obj) {
    throw new Error(`Chunks not found: ${key}`);
  }
  return JSON.parse(await obj.text()) as StoredChunks;
}

/**
 * Store embeddings in R2 for batch
 */
export async function storeEmbeddings(
  bucket: R2Bucket,
  instanceId: string,
  batchIndex: number,
  embeddings: StoredEmbeddings['embeddings']
): Promise<string> {
  const key = getStateKey(instanceId, `embeddings-${batchIndex}`);
  const data: StoredEmbeddings = { embeddings, count: embeddings.length };
  await bucket.put(key, JSON.stringify(data));
  return key;
}

/**
 * Load embeddings from R2 for batch
 */
export async function loadEmbeddings(
  bucket: R2Bucket,
  instanceId: string,
  batchIndex: number
): Promise<StoredEmbeddings> {
  const key = getStateKey(instanceId, `embeddings-${batchIndex}`);
  const obj = await bucket.get(key);
  if (!obj) {
    throw new Error(`Embeddings not found: ${key}`);
  }
  return JSON.parse(await obj.text()) as StoredEmbeddings;
}

/**
 * Clean up workflow state from R2
 */
export async function cleanupWorkflowState(
  bucket: R2Bucket,
  instanceId: string
): Promise<void> {
  const prefix = `workflows/${instanceId}/`;
  const listed = await bucket.list({ prefix });

  if (listed.objects.length > 0) {
    // Delete all objects with this prefix
    for (const obj of listed.objects) {
      await bucket.delete(obj.key);
    }
  }
}

// ============================================================================
// Embedding Step Helper
// ============================================================================

/**
 * Embed a single batch of chunks
 *
 * This function is designed to be called within a workflow step.
 * It loads chunks from R2, generates embeddings, and stores results in R2.
 *
 * @param bucket R2 bucket for state storage
 * @param instanceId Workflow instance ID
 * @param batchIndex Batch index (0-based)
 * @param openaiApiKey OpenAI API key
 * @returns Number of embeddings generated
 *
 * @example
 * ```typescript
 * await step.do(`embed-batch-${i}`, { retries: { limit: 4, backoff: "exponential" } },
 *   async () => embedBatchStep(env.DOCUMENTS_BUCKET, instanceId, i, env.OPENAI_API_KEY));
 * ```
 */
export async function embedBatchStep(
  bucket: R2Bucket,
  instanceId: string,
  batchIndex: number,
  openaiApiKey: string
): Promise<number> {
  // Load all chunks
  const { chunks } = await loadChunks(bucket, instanceId);

  // Calculate batch range
  const startIdx = batchIndex * EMBED_BATCH_SIZE;
  const endIdx = Math.min(startIdx + EMBED_BATCH_SIZE, chunks.length);
  const batchChunks = chunks.slice(startIdx, endIdx);

  if (batchChunks.length === 0) {
    return 0;
  }

  // Extract texts for embedding
  const texts = batchChunks.map((c) => c.text);

  // Generate embeddings via OpenAI
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts,
    encoding_format: 'float',
  });

  // Map embeddings to chunk IDs
  const embeddings = response.data.map((d, i) => ({
    chunkId: batchChunks[i]!.chunkId,
    values: d.embedding,
  }));

  // Store embeddings in R2
  await storeEmbeddings(bucket, instanceId, batchIndex, embeddings);

  console.log(
    `[Workflow] Embedded batch ${batchIndex}: ${embeddings.length} chunks`
  );

  return embeddings.length;
}

// ============================================================================
// Upsert Step Helper
// ============================================================================

/**
 * Upsert a single batch of embeddings to Pinecone
 *
 * This function is designed to be called within a workflow step.
 * It loads embeddings and chunk metadata from R2, then upserts to Pinecone.
 *
 * @param bucket R2 bucket for state storage
 * @param instanceId Workflow instance ID
 * @param batchIndex Batch index (0-based)
 * @param pineconeApiKey Pinecone API key
 * @returns Number of vectors upserted
 *
 * @example
 * ```typescript
 * await step.do(`upsert-batch-${i}`, { retries: { limit: 3 } },
 *   async () => upsertBatchStep(env.DOCUMENTS_BUCKET, instanceId, i, env.PINECONE_API_KEY));
 * ```
 */
export async function upsertBatchStep(
  bucket: R2Bucket,
  instanceId: string,
  batchIndex: number,
  pineconeApiKey: string
): Promise<number> {
  // Load chunks (for metadata)
  const { chunks } = await loadChunks(bucket, instanceId);

  // Calculate which embedding batches contain vectors for this upsert batch
  // Embedding batch size: 64, Upsert batch size: 100
  // Need to load potentially multiple embedding batches
  const startIdx = batchIndex * UPSERT_BATCH_SIZE;
  const endIdx = Math.min(startIdx + UPSERT_BATCH_SIZE, chunks.length);

  // Determine which embed batches we need
  const firstEmbedBatch = Math.floor(startIdx / EMBED_BATCH_SIZE);
  const lastEmbedBatch = Math.floor((endIdx - 1) / EMBED_BATCH_SIZE);

  // Load all required embedding batches
  const allEmbeddings: StoredEmbeddings['embeddings'] = [];
  for (let eb = firstEmbedBatch; eb <= lastEmbedBatch; eb++) {
    const { embeddings } = await loadEmbeddings(bucket, instanceId, eb);
    allEmbeddings.push(...embeddings);
  }

  // Map embeddings by chunk ID for lookup
  const embeddingMap = new Map(
    allEmbeddings.map((e) => [e.chunkId, e.values])
  );

  // Get chunks for this upsert batch
  const batchChunks = chunks.slice(startIdx, endIdx);

  // Build Pinecone vectors
  const vectors = batchChunks.map((chunk) => {
    const values = embeddingMap.get(chunk.chunkId);
    if (!values) {
      throw new Error(`Missing embedding for chunk: ${chunk.chunkId}`);
    }

    return {
      id: chunk.chunkId,
      values,
      metadata: chunk.metadata as ChunkMetadata,
    };
  });

  if (vectors.length === 0) {
    return 0;
  }

  // Initialize Pinecone and upsert
  const pinecone = new Pinecone({ apiKey: pineconeApiKey });
  const index = pinecone.index<ChunkMetadata>('compliance-embeddings');

  await index.upsert(vectors);

  console.log(
    `[Workflow] Upserted batch ${batchIndex}: ${vectors.length} vectors`
  );

  return vectors.length;
}

// ============================================================================
// Batch Calculation Helpers
// ============================================================================

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

// ============================================================================
// Progress Tracking
// ============================================================================

/**
 * Store progress in R2 for monitoring
 */
export async function storeProgress(
  bucket: R2Bucket,
  instanceId: string,
  progress: {
    phase: string;
    completed: number;
    total: number;
    message?: string;
  }
): Promise<void> {
  const key = getStateKey(instanceId, 'progress');
  await bucket.put(
    key,
    JSON.stringify({
      ...progress,
      updatedAt: new Date().toISOString(),
    })
  );
}

/**
 * Load progress from R2
 */
export async function loadProgress(
  bucket: R2Bucket,
  instanceId: string
): Promise<{
  phase: string;
  completed: number;
  total: number;
  message?: string;
  updatedAt: string;
} | null> {
  const key = getStateKey(instanceId, 'progress');
  const obj = await bucket.get(key);
  if (!obj) {
    return null;
  }
  return JSON.parse(await obj.text());
}
