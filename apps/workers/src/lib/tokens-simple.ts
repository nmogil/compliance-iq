/**
 * Simple Token Estimation
 *
 * Lightweight token counting using word/character estimation.
 * Avoids CPU-intensive tiktoken initialization for workflow compatibility.
 *
 * For accurate token counting in non-workflow contexts, use './tokens' instead.
 */

/**
 * Average characters per token for English text (empirically determined for GPT models)
 * cl100k_base encoding averages ~4 characters per token for English prose
 */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count using character-based approximation
 * This is faster than tiktoken and avoids CPU-intensive initialization
 *
 * @param text Text to estimate tokens for
 * @returns Estimated number of tokens
 */
export function countTokens(text: string): number {
  if (!text) return 0;

  // Character-based estimation: divide by average chars per token
  // Add 10% buffer to be conservative (better to have smaller chunks)
  const baseEstimate = Math.ceil(text.length / CHARS_PER_TOKEN);
  return Math.ceil(baseEstimate * 1.1);
}

/**
 * Validate that text chunk is within token limit
 *
 * @param text Text to validate
 * @param maxTokens Maximum allowed tokens (default 1500)
 * @returns Object with validity flag and estimated token count
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
 */
export function estimateChunkCount(
  text: string,
  targetTokens: number = 1500
): number {
  const totalTokens = countTokens(text);
  return Math.ceil(totalTokens / targetTokens);
}

/**
 * Check if text is within embedding model's absolute limit
 * (OpenAI text-embedding-3-large has 8192 token limit)
 *
 * @param text Text to check
 * @returns True if estimated to be within limit
 */
export function isWithinModelLimit(text: string): boolean {
  const tokens = countTokens(text);
  // Use 7500 instead of 8192 for safety margin
  return tokens <= 7500;
}
