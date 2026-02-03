/**
 * Token Distribution Analyzer
 *
 * Analyzes token counts across chunks to detect size distribution issues,
 * oversized chunks, and calculate percentiles for quality validation.
 *
 * Validates DATA-07: Chunking pipeline splits text into embeddable segments.
 */

import { countTokens } from '../lib/tokens';
import type {
  TokenDistribution,
  TokenLimits,
  TokenValidationResult,
  OutlierResult,
} from './types';

/**
 * Calculate percentile from sorted array of values
 *
 * @param sortedValues - Array of values sorted in ascending order
 * @param percentile - Percentile to calculate (0-100)
 * @returns Percentile value
 *
 * @example
 * ```ts
 * const sorted = [100, 200, 300, 400, 500];
 * const p95 = getPercentile(sorted, 95); // 500
 * ```
 */
function getPercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.floor(sortedValues.length * (percentile / 100));
  return sortedValues[Math.min(index, sortedValues.length - 1)] || 0;
}

/**
 * Analyze token distribution across a collection of text chunks
 *
 * Calculates min, max, average, and percentile statistics for token counts.
 * Uses countTokens from lib/tokens.ts for accurate cl100k_base encoding.
 *
 * @param texts - Array of text chunks to analyze
 * @returns Token distribution statistics
 *
 * @example
 * ```ts
 * const chunks = ["First chunk", "Second chunk", "Third chunk"];
 * const distribution = analyzeTokenDistribution(chunks);
 * console.log(`Avg: ${distribution.avg}, P95: ${distribution.p95}`);
 * ```
 */
export function analyzeTokenDistribution(texts: string[]): TokenDistribution {
  // Handle empty array case
  if (texts.length === 0) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      count: 0,
    };
  }

  // Count tokens for each text
  const tokenCounts = texts.map((text) => countTokens(text));

  // Sort for percentile calculations
  const sorted = [...tokenCounts].sort((a, b) => a - b);

  // Calculate statistics
  const min = sorted[0] || 0;
  const max = sorted[sorted.length - 1] || 0;
  const sum = tokenCounts.reduce((acc, count) => acc + count, 0);
  const avg = Math.round(sum / tokenCounts.length);

  return {
    min,
    max,
    avg,
    p50: getPercentile(sorted, 50),
    p95: getPercentile(sorted, 95),
    p99: getPercentile(sorted, 99),
    count: texts.length,
  };
}

/**
 * Validate chunks against soft and hard token limits
 *
 * Identifies chunks exceeding recommended (soft) and absolute (hard) limits.
 * Soft limit is typically 1500 tokens (recommended max for quality embeddings).
 * Hard limit is 8191 tokens (text-embedding-3-large model limit).
 *
 * @param texts - Array of text chunks to validate
 * @param limits - Token limit thresholds
 * @returns Validation result with indices of problematic chunks
 *
 * @example
 * ```ts
 * const chunks = ["Short text", veryLongText];
 * const result = validateTokenLimits(chunks, {
 *   softLimit: 1500,
 *   hardLimit: 8191
 * });
 * if (!result.valid) {
 *   console.log(`${result.overSoftLimit.length} chunks exceed soft limit`);
 * }
 * ```
 */
export function validateTokenLimits(
  texts: string[],
  limits: TokenLimits
): TokenValidationResult {
  const overSoftLimit: number[] = [];
  const overHardLimit: number[] = [];

  texts.forEach((text, index) => {
    const tokens = countTokens(text);

    if (tokens > limits.hardLimit) {
      overHardLimit.push(index);
    }
    if (tokens > limits.softLimit) {
      overSoftLimit.push(index);
    }
  });

  return {
    valid: overSoftLimit.length === 0 && overHardLimit.length === 0,
    overSoftLimit,
    overHardLimit,
  };
}

/**
 * Generate human-readable summary of token distribution
 *
 * @param distribution - Token distribution statistics
 * @returns Formatted summary string
 *
 * @example
 * ```ts
 * const distribution = analyzeTokenDistribution(chunks);
 * const summary = getDistributionSummary(distribution);
 * console.log(summary);
 * // "Tokens: avg=850, range=[200-1450], p95=1200"
 * ```
 */
export function getDistributionSummary(distribution: TokenDistribution): string {
  return `Tokens: avg=${distribution.avg}, range=[${distribution.min}-${distribution.max}], p95=${distribution.p95}`;
}

/**
 * Detect statistical outliers in token distribution
 *
 * Identifies chunks with token counts more than `threshold` standard
 * deviations away from the mean. Useful for finding unusually large
 * or small chunks that may indicate chunking issues.
 *
 * @param texts - Array of text chunks to analyze
 * @param threshold - Number of standard deviations to consider outlier (default: 2)
 * @returns Outlier analysis result
 *
 * @example
 * ```ts
 * const result = detectOutliers(chunks, 2);
 * console.log(`Found ${result.outliers.length} outliers`);
 * result.outliers.forEach(outlier => {
 *   console.log(`Chunk ${outlier.index}: ${outlier.tokens} tokens (${outlier.deviation}σ)`);
 * });
 * ```
 */
export function detectOutliers(
  texts: string[],
  threshold: number = 2
): OutlierResult {
  // Handle empty array
  if (texts.length === 0) {
    return {
      outliers: [],
      stats: {
        mean: 0,
        stdDev: 0,
      },
    };
  }

  // Count tokens for each text
  const tokenCounts = texts.map((text) => countTokens(text));

  // Calculate mean
  const sum = tokenCounts.reduce((acc, count) => acc + count, 0);
  const mean = sum / tokenCounts.length;

  // Calculate standard deviation
  const squaredDiffs = tokenCounts.map((count) => Math.pow(count - mean, 2));
  const variance = squaredDiffs.reduce((acc, diff) => acc + diff, 0) / tokenCounts.length;
  const stdDev = Math.sqrt(variance);

  // Identify outliers
  const outliers = tokenCounts
    .map((tokens, index) => {
      const deviation = Math.abs(tokens - mean) / stdDev;
      return { index, tokens, deviation };
    })
    .filter((item) => item.deviation > threshold);

  return {
    outliers,
    stats: {
      mean: Math.round(mean),
      stdDev: Math.round(stdDev * 100) / 100, // Round to 2 decimal places
    },
  };
}
