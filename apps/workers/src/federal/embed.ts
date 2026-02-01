/**
 * Embedding Generation Pipeline
 *
 * OpenAI text-embedding-3-large integration for CFR chunks.
 * Handles batching, rate limits, token validation, and retry logic.
 */

import OpenAI from 'openai';
import type { CFRChunk } from './types';
import { validateChunkSize } from '../lib/tokens';

/**
 * Batch size for embedding generation
 * OpenAI recommends 64 chunks per batch for text-embedding-3-large
 */
const BATCH_SIZE = 64;

/**
 * Delay between batches to avoid rate limits (100ms)
 */
const BATCH_DELAY_MS = 100;

/**
 * Maximum retry attempts for rate limit errors
 */
const MAX_RETRIES = 4;

/**
 * Initial retry delay for exponential backoff (1 second)
 */
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Embedding error types
 */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly code: 'RATE_LIMIT' | 'TOKEN_LIMIT' | 'API_ERROR',
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/**
 * Generate embeddings for array of text strings
 *
 * Uses OpenAI text-embedding-3-large (3072 dimensions).
 * Validates token counts before API call and retries on rate limits.
 *
 * @param texts Array of text strings to embed
 * @param apiKey OpenAI API key
 * @returns Array of 3072-dimension vectors (one per text)
 * @throws {EmbeddingError} If token limit exceeded, rate limit persistent, or API error
 *
 * @example
 * ```ts
 * const embeddings = await generateEmbeddings(
 *   ["Section 117.3 defines current good manufacturing practice...", "Section 117.4..."],
 *   process.env.OPENAI_API_KEY
 * );
 * console.log(embeddings.length); // 2
 * console.log(embeddings[0].length); // 3072
 * ```
 */
export async function generateEmbeddings(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  // Validate all texts before API call
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;

    const validation = validateChunkSize(text, 8191); // Hard limit for text-embedding-3-large
    if (!validation.valid) {
      throw new EmbeddingError(
        `Text at index ${i} exceeds token limit: ${validation.tokens} tokens (max 8191)`,
        'TOKEN_LIMIT',
        { index: i, tokens: validation.tokens }
      );
    }
  }

  const openai = new OpenAI({ apiKey });

  // Retry logic with exponential backoff
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: texts,
        encoding_format: 'float',
      });

      return response.data.map(d => d.embedding);
    } catch (error: unknown) {
      lastError = error;

      // Check if rate limit error (429)
      const isRateLimit =
        error &&
        typeof error === 'object' &&
        'status' in error &&
        error.status === 429;

      if (isRateLimit && attempt < MAX_RETRIES - 1) {
        // Calculate exponential backoff delay: 1s, 2s, 4s, 8s
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        console.log(
          `Rate limit hit, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      // If not rate limit or max retries reached, break
      break;
    }
  }

  // All retries exhausted or non-retryable error
  const isRateLimit =
    lastError &&
    typeof lastError === 'object' &&
    'status' in lastError &&
    lastError.status === 429;

  if (isRateLimit) {
    throw new EmbeddingError(
      'Rate limit exceeded after max retries',
      'RATE_LIMIT',
      lastError
    );
  }

  throw new EmbeddingError(
    'Failed to generate embeddings',
    'API_ERROR',
    lastError
  );
}

/**
 * Embedded chunk - CFR chunk with vector embedding
 */
export interface EmbeddedChunk {
  /** Original chunk with metadata */
  chunk: CFRChunk;
  /** 3072-dimension embedding vector */
  embedding: number[];
}

/**
 * Progress callback for batch processing
 */
export type ProgressCallback = (current: number, total: number) => void;

/**
 * Embedding statistics
 */
export interface EmbeddingStats {
  /** Total chunks processed */
  totalChunks: number;
  /** Total batches processed */
  totalBatches: number;
  /** Average embedding time per batch (milliseconds) */
  avgEmbeddingTimeMs: number;
  /** Number of chunks that failed validation/embedding */
  failedChunks: number;
}

/**
 * Embed array of CFR chunks with batching
 *
 * Processes chunks in batches of 64 with 100ms delay between batches
 * to avoid rate limits. Validates token counts before each batch.
 *
 * @param chunks Array of CFR chunks to embed
 * @param apiKey OpenAI API key
 * @param onProgress Optional progress callback (current, total)
 * @returns Array of embedded chunks (chunk + embedding)
 * @throws {EmbeddingError} If token validation fails or API error
 *
 * @example
 * ```ts
 * const embedded = await embedChunks(
 *   cfrChunks,
 *   process.env.OPENAI_API_KEY,
 *   (current, total) => console.log(`Progress: ${current}/${total}`)
 * );
 * ```
 */
export async function embedChunks(
  chunks: CFRChunk[],
  apiKey: string,
  onProgress?: ProgressCallback
): Promise<EmbeddedChunk[]> {
  const results: EmbeddedChunk[] = [];
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
  const batchTimes: number[] = [];

  console.log(`Starting embedding: ${chunks.length} chunks in ${totalBatches} batches`);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchStartTime = Date.now();
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map(c => c.text);

    // Validate all texts in batch before API call
    for (const chunk of batch) {
      const validation = validateChunkSize(chunk.text, 8191);
      if (!validation.valid) {
        throw new EmbeddingError(
          `Chunk ${chunk.chunkId} exceeds token limit: ${validation.tokens} tokens (max 8191)`,
          'TOKEN_LIMIT',
          { chunkId: chunk.chunkId, tokens: validation.tokens }
        );
      }
    }

    // Generate embeddings for batch
    const embeddings = await generateEmbeddings(texts, apiKey);

    // Combine chunks with embeddings
    batch.forEach((chunk, idx) => {
      const embedding = embeddings[idx];
      if (!embedding) {
        throw new EmbeddingError(
          `Missing embedding for chunk ${chunk.chunkId}`,
          'API_ERROR',
          { chunkId: chunk.chunkId, index: idx }
        );
      }
      results.push({ chunk, embedding });
    });

    const batchTime = Date.now() - batchStartTime;
    batchTimes.push(batchTime);

    // Progress logging
    console.log(
      `Embedding batch ${batchNumber}/${totalBatches} (${batch.length} chunks, ${batchTime}ms)`
    );

    // Progress callback
    if (onProgress) {
      onProgress(i + batch.length, chunks.length);
    }

    // Delay between batches to respect rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  const totalTime = batchTimes.reduce((sum, time) => sum + time, 0);
  const avgTime = batchTimes.length > 0 ? totalTime / batchTimes.length : 0;

  console.log(
    `Embedding complete: ${results.length} chunks, ${totalBatches} batches, ${Math.round(avgTime)}ms avg per batch`
  );

  return results;
}

/**
 * Calculate embedding statistics
 *
 * @param chunks Array of embedded chunks
 * @returns Statistics object
 */
export function getEmbeddingStats(chunks: EmbeddedChunk[]): EmbeddingStats {
  const totalChunks = chunks.length;
  const totalBatches = Math.ceil(totalChunks / BATCH_SIZE);

  return {
    totalChunks,
    totalBatches,
    avgEmbeddingTimeMs: 0, // Would need to track during embedChunks() call
    failedChunks: 0, // Would need to track failures during processing
  };
}
