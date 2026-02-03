import type { ChunkMetadata } from '../pinecone';

/**
 * Statistics for chunk token counts across a dataset.
 * Used to analyze chunk size distribution and identify outliers.
 */
export interface TokenDistribution {
  /** Minimum token count across all chunks */
  min: number;
  /** Maximum token count across all chunks */
  max: number;
  /** Average (mean) token count */
  avg: number;
  /** Median token count (50th percentile) */
  p50: number;
  /** 95th percentile token count */
  p95: number;
  /** 99th percentile token count (identifies extreme outliers) */
  p99: number;
}

/**
 * Counts of chunks with optional metadata fields populated.
 * Tracks completeness of metadata across the dataset.
 */
export interface MetadataCompleteness {
  /** Number of chunks with category field set */
  hasCategory: number;
  /** Number of chunks with title field set */
  hasTitle: number;
  /** Number of chunks with lastUpdated field set */
  hasLastUpdated: number;
}

/**
 * Data quality metrics for a single jurisdiction.
 * Provides comprehensive quality report including token distribution,
 * citation coverage, metadata completeness, and specific issues.
 */
export interface DataQualityReport {
  /** Jurisdiction identifier (e.g., 'US', 'TX', 'TX-48201', 'TX-houston') */
  jurisdiction: string;
  /** Source type for this jurisdiction */
  sourceType: 'federal' | 'state' | 'county' | 'municipal';
  /** ISO 8601 timestamp when this report was generated */
  timestamp: string;
  /** Total number of chunks indexed for this jurisdiction */
  totalChunks: number;
  /** Token count distribution statistics */
  tokenDistribution: TokenDistribution;
  /** Percentage of chunks with valid citations (0-100) */
  citationCoverage: number;
  /** Metadata field completeness counts */
  metadataCompleteness: MetadataCompleteness;
  /** List of specific issues found during validation */
  issues: Array<{
    /** Chunk ID where issue was found */
    chunkId: string;
    /** Description of the issue */
    issue: string;
  }>;
}

/**
 * Coverage status for a single jurisdiction.
 * Tracks whether a jurisdiction is expected, indexed, and operational.
 */
export interface JurisdictionCoverage {
  /** Human-readable jurisdiction name */
  name: string;
  /** Machine identifier (FIPS code, cityId, state abbreviation, etc.) */
  identifier: string;
  /** Whether this jurisdiction should be indexed */
  expected: boolean;
  /** Whether this jurisdiction has been indexed */
  indexed: boolean;
  /** Number of vectors in Pinecone for this jurisdiction */
  vectorCount: number;
  /** Current status of this jurisdiction */
  status: 'active' | 'pending' | 'error' | 'missing';
  /** ISO 8601 timestamp of last successful indexing (if available) */
  lastIndexedAt?: string;
}

/**
 * Cross-jurisdiction coverage summary report.
 * Tracks expected vs actual coverage across all source types.
 */
export interface CoverageReport {
  /** ISO 8601 timestamp when this report was generated */
  generatedAt: string;
  /** Total number of jurisdictions expected to be indexed */
  totalExpected: number;
  /** Total number of jurisdictions actually indexed */
  totalIndexed: number;
  /** Overall coverage percentage (0-100) */
  coveragePercent: number;
  /** Breakdown by source type */
  bySourceType: {
    federal: { expected: number; indexed: number };
    state: { expected: number; indexed: number };
    county: { expected: number; indexed: number };
    municipal: { expected: number; indexed: number };
  };
  /** Detailed coverage status for each jurisdiction */
  jurisdictions: JurisdictionCoverage[];
  /** List of coverage gaps with explanations */
  gaps: Array<{
    /** Jurisdiction identifier */
    jurisdiction: string;
    /** Reason for the gap */
    reason: string;
  }>;
}

/**
 * Overall validation outcome for the data processing pipeline.
 * Combines quality reports and coverage analysis into single result.
 */
export interface ValidationResult {
  /** Whether validation passed all checks */
  success: boolean;
  /** ISO 8601 timestamp when validation was run */
  timestamp: string;
  /** Data quality reports per jurisdiction */
  qualityReports: DataQualityReport[];
  /** Coverage report across all jurisdictions */
  coverageReport: CoverageReport;
  /** High-level summary statistics */
  summary: {
    /** Total chunks across all jurisdictions */
    totalChunks: number;
    /** Average token count across all chunks */
    avgTokens: number;
    /** Overall coverage percentage */
    coveragePercent: number;
    /** Total number of issues found */
    issuesCount: number;
  };
}

/**
 * R2 storage validation outcome.
 * Verifies that expected folder structure and data exist in R2.
 */
export interface R2ValidationResult {
  /** Whether R2 storage validation passed */
  valid: boolean;
  /** Expected folders that don't exist in R2 */
  missingFolders: string[];
  /** Jurisdictions with no R2 objects (empty data) */
  jurisdictionsWithoutData: string[];
}

/**
 * Convex sync validation outcome.
 * Verifies that Convex jurisdiction tracking is in sync with Pinecone.
 */
export interface ConvexValidationResult {
  /** Whether Convex sync validation passed */
  valid: boolean;
  /** Jurisdictions indexed in Pinecone but not tracked in Convex */
  missingInConvex: string[];
  /** Jurisdictions with null/missing lastScrapedAt timestamps */
  staleJurisdictions: string[];
  /** Jurisdictions where vector count doesn't match between Convex and Pinecone */
  vectorCountMismatches: Array<{
    /** Jurisdiction identifier */
    jurisdiction: string;
    /** Vector count recorded in Convex */
    convex: number;
    /** Actual vector count in Pinecone */
    pinecone: number;
  }>;
}
