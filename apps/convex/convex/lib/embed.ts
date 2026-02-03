/**
 * Query Embedding Generation
 *
 * OpenAI text-embedding-3-large integration for user queries.
 * Simpler than batch embedding in workers - only embeds one query at a time.
 */

import OpenAI from 'openai';

/**
 * Embedding error class for error handling
 */
export class EmbeddingError extends Error {
  public override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EmbeddingError';
    this.cause = cause;
  }
}

/**
 * Generate embedding for a single query string
 *
 * Uses OpenAI text-embedding-3-large (3072 dimensions) for semantic search.
 *
 * @param query User's question text
 * @param apiKey OpenAI API key
 * @returns 3072-dimension embedding vector
 * @throws {EmbeddingError} If API call fails
 *
 * @example
 * ```ts
 * const embedding = await embedQuery(
 *   "What permits are needed for a retail food facility?",
 *   process.env.OPENAI_API_KEY
 * );
 * console.log(embedding.length); // 3072
 * ```
 */
export async function embedQuery(
  query: string,
  apiKey: string
): Promise<number[]> {
  try {
    const openai = new OpenAI({ apiKey });

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: query,
      encoding_format: 'float',
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new EmbeddingError('No embedding returned from OpenAI API');
    }
    return embedding;
  } catch (error: unknown) {
    throw new EmbeddingError(
      `Failed to generate query embedding: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    );
  }
}
