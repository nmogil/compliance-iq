/**
 * Token Counting Utilities
 *
 * Provides accurate token counting for OpenAI's text-embedding-3-large model
 * using the cl100k_base encoding (tiktoken).
 */

import { encodingForModel } from 'js-tiktoken';

/**
 * Count tokens in text using cl100k_base encoding
 * (used by text-embedding-3-large model)
 *
 * @param text Text to count tokens for
 * @returns Number of tokens
 *
 * @example
 * ```ts
 * const count = countTokens("Hello world");
 * console.log(count); // 2
 * ```
 */
export function countTokens(text: string): number {
  // Get encoder for text-embedding-3-large (cl100k_base)
  const encoder = encodingForModel('text-embedding-3-large');

  // Encode text to tokens
  const tokens = encoder.encode(text);
  return tokens.length;
}

/**
 * Validate that text chunk is within token limit
 *
 * @param text Text to validate
 * @param maxTokens Maximum allowed tokens (default 1500, well under 8192 limit)
 * @returns Object with validity flag and actual token count
 *
 * @example
 * ```ts
 * const result = validateChunkSize(longText, 1500);
 * if (!result.valid) {
 *   console.log(`Chunk too large: ${result.tokens} tokens`);
 * }
 * ```
 */
export function validateChunkSize(
  text: string,
  maxTokens: number = 1500
): { valid: boolean; tokens: number } {
  const tokens = countTokens(text);
  return {
    valid: tokens <= maxTokens,
    tokens,
  };
}

/**
 * Estimate how many chunks text will split into
 *
 * @param text Full text to estimate
 * @param targetTokens Target tokens per chunk (default 1500)
 * @returns Estimated number of chunks needed
 *
 * @example
 * ```ts
 * const chunks = estimateChunkCount(sectionText, 1500);
 * console.log(`Will create approximately ${chunks} chunks`);
 * ```
 */
export function estimateChunkCount(
  text: string,
  targetTokens: number = 1500
): number {
  const totalTokens = countTokens(text);

  // Calculate chunks needed, rounding up
  return Math.ceil(totalTokens / targetTokens);
}

/**
 * Check if text is within embedding model's absolute limit
 * (OpenAI text-embedding-3-large has 8192 token limit)
 *
 * @param text Text to check
 * @returns True if within limit, false otherwise
 */
export function isWithinModelLimit(text: string): boolean {
  const tokens = countTokens(text);
  return tokens <= 8192;
}
