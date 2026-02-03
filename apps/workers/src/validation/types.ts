/**
 * Data Processing Validation Types
 *
 * Type definitions for validating the end-to-end data processing pipeline
 * across all jurisdiction types (federal, state, county, municipal).
 */

/**
 * Token distribution statistics for a collection of text chunks
 */
export interface TokenDistribution {
  /** Minimum token count across all chunks */
  min: number;
  /** Maximum token count across all chunks */
  max: number;
  /** Average token count */
  avg: number;
  /** 50th percentile (median) */
  p50: number;
  /** 95th percentile */
  p95: number;
  /** 99th percentile */
  p99: number;
  /** Total number of chunks analyzed */
  count: number;
}

/**
 * Token limit thresholds for validation
 */
export interface TokenLimits {
  /** Recommended maximum tokens per chunk (typically 1500) */
  softLimit: number;
  /** Absolute maximum tokens for embedding model (8191 for text-embedding-3-large) */
  hardLimit: number;
}

/**
 * Result of token limit validation
 */
export interface TokenValidationResult {
  /** True if all chunks are within limits */
  valid: boolean;
  /** Indices of chunks exceeding soft limit */
  overSoftLimit: number[];
  /** Indices of chunks exceeding hard limit */
  overHardLimit: number[];
}

/**
 * Statistical outlier information
 */
export interface OutlierResult {
  /** Chunks identified as statistical outliers */
  outliers: Array<{
    /** Index of the outlier chunk */
    index: number;
    /** Token count of the outlier */
    tokens: number;
    /** Standard deviations from mean */
    deviation: number;
  }>;
  /** Distribution statistics */
  stats: {
    /** Mean token count */
    mean: number;
    /** Standard deviation */
    stdDev: number;
  };
}
