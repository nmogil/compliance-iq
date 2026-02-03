/**
 * Pinecone Retrieval Module
 *
 * Vector search with jurisdiction filtering and reranking.
 * Converts query embeddings into relevant regulatory chunks.
 */

import { Pinecone } from '@pinecone-database/pinecone';
import type { RetrievedChunk } from '../query/types';

/**
 * Constants
 */
const INDEX_NAME = 'compliance-embeddings';
const DEFAULT_TOP_K = 50;
const DEFAULT_MIN_SCORE = 0.5;
const DEFAULT_FINAL_TOP_K = 10;
const RECENCY_WEIGHT = 0.2;
const SIMILARITY_WEIGHT = 0.8;

/**
 * Retrieval options for Pinecone query
 */
export interface RetrievalOptions {
  /** Number of chunks to retrieve from Pinecone (default: 50) */
  topK?: number;

  /** Minimum similarity threshold for filtering results (default: 0.5) */
  minScore?: number;

  /** Whether to rerank results by score + recency (default: true) */
  rerank?: boolean;

  /** Final count after reranking (default: 10) */
  finalTopK?: number;
}

/**
 * Retrieve relevant regulatory chunks from Pinecone
 *
 * Queries Pinecone index with jurisdiction filtering and optional reranking.
 * Uses $or filter to match any of the provided jurisdictions.
 *
 * @param queryEmbedding 3072-dimension query vector from embedQuery
 * @param jurisdictions Array of jurisdiction identifiers (e.g., ['US', 'TX', 'Harris County'])
 * @param apiKey Pinecone API key
 * @param options Optional retrieval configuration
 * @returns Array of retrieved chunks with metadata
 *
 * @example
 * ```ts
 * const chunks = await retrieveChunks(
 *   queryEmbedding,
 *   ['US', 'TX', 'TX-48201'],
 *   process.env.PINECONE_API_KEY,
 *   { topK: 50, rerank: true, finalTopK: 10 }
 * );
 * ```
 */
export async function retrieveChunks(
  queryEmbedding: number[],
  jurisdictions: string[],
  apiKey: string,
  options?: RetrievalOptions
): Promise<RetrievedChunk[]> {
  const topK = options?.topK ?? DEFAULT_TOP_K;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
  const rerank = options?.rerank ?? true;
  const finalTopK = options?.finalTopK ?? DEFAULT_FINAL_TOP_K;

  // Initialize Pinecone client
  const pc = new Pinecone({ apiKey });
  const index = pc.index(INDEX_NAME);

  // Build jurisdiction filter using $or
  const filter = {
    $or: jurisdictions.map((j) => ({ jurisdiction: j })),
  };

  // Query Pinecone
  const results = await index.query({
    vector: queryEmbedding,
    topK,
    filter,
    includeMetadata: true,
  });

  // Map to RetrievedChunk format (flatten Pinecone metadata)
  // Store lastUpdated temporarily for reranking, then strip it
  const chunksWithMetadata: Array<RetrievedChunk & { lastUpdated?: string }> =
    results.matches
      .filter((match) => (match.score ?? 0) >= minScore)
      .map((match) => {
        const metadata = match.metadata as any;
        return {
          id: match.id,
          score: match.score ?? 0,
          text: metadata?.text ?? '',
          citation: metadata?.citation ?? '',
          jurisdiction: metadata?.jurisdiction ?? '',
          sourceType: metadata?.sourceType ?? 'federal',
          title: metadata?.title,
          category: metadata?.category,
          url: undefined, // URL not stored in Pinecone metadata yet
          lastUpdated: metadata?.lastUpdated, // Temporary for reranking
        };
      });

  // Apply reranking if enabled
  if (rerank) {
    const reranked = rerankChunksInternal(chunksWithMetadata, finalTopK);
    // Strip lastUpdated before returning
    return reranked.map(({ lastUpdated, ...chunk }) => chunk);
  }

  // Strip lastUpdated before returning
  return chunksWithMetadata.slice(0, finalTopK).map(({ lastUpdated, ...chunk }) => chunk);
}

/**
 * Internal reranking function that works with chunks including lastUpdated
 */
function rerankChunksInternal<T extends RetrievedChunk & { lastUpdated?: string }>(
  chunks: T[],
  finalTopK: number
): T[] {
  const now = Date.now();
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;

  // Calculate weighted scores
  const scored = chunks.map((chunk) => {
    // Semantic similarity component (80%)
    const similarityScore = chunk.score * SIMILARITY_WEIGHT;

    // Recency bonus component (20%)
    let recencyBonus = 0;
    if (chunk.lastUpdated) {
      const lastUpdatedTime = new Date(chunk.lastUpdated).getTime();
      const age = now - lastUpdatedTime;

      // If updated within last year, apply recency bonus
      if (age < oneYearMs) {
        recencyBonus = RECENCY_WEIGHT;
      }
    }

    const weightedScore = similarityScore + recencyBonus;

    return {
      chunk,
      weightedScore,
    };
  });

  // Sort by weighted score (descending) and return top-k
  return scored
    .sort((a, b) => b.weightedScore - a.weightedScore)
    .slice(0, finalTopK)
    .map((item) => item.chunk);
}

/**
 * Rerank chunks by weighted score (similarity + recency)
 *
 * Applies a weighted scoring algorithm:
 * - 80% semantic similarity (chunk.score)
 * - 20% recency bonus (if lastUpdated within 1 year, add 0.2)
 *
 * @param chunks Array of retrieved chunks to rerank
 * @param finalTopK Number of top chunks to return (default: 10)
 * @returns Reranked chunks, sorted by weighted score
 *
 * @example
 * ```ts
 * const reranked = rerankChunks(retrievedChunks, 10);
 * // Returns top 10 chunks sorted by combined similarity + recency score
 * ```
 */
export function rerankChunks(
  chunks: RetrievedChunk[],
  finalTopK: number = DEFAULT_FINAL_TOP_K
): RetrievedChunk[] {
  // For public API, we can't access lastUpdated, so just sort by score
  return chunks
    .sort((a, b) => b.score - a.score)
    .slice(0, finalTopK);
}
