/**
 * Municipal Data Types
 *
 * Type definitions for municipal ordinance data pipeline.
 * Used by storage, scraper, parser, and pipeline modules.
 */

// ============================================================================
// City Configuration
// ============================================================================

/**
 * Configuration for a municipal code source
 *
 * Platform-specific settings for Firecrawl scraping.
 */
export interface MunicipalCityConfig {
  /** Display name (e.g., "Houston") */
  name: string;
  /** URL-safe identifier (e.g., "houston") */
  cityId: string;
  /** Code library platform */
  platform: 'municode' | 'amlegal';
  /** Base URL for code library */
  baseUrl: string;
  /** Whether this city is enabled for scraping */
  enabled: boolean;
  /** Reason if disabled */
  skipReason?: string;
  /** Firecrawl-specific configuration */
  firecrawlConfig?: {
    /** Milliseconds to wait for JavaScript rendering */
    waitFor?: number;
    /** Filter to main content only */
    onlyMainContent?: boolean;
  };
}

// ============================================================================
// Ordinance Data
// ============================================================================

/**
 * Parsed municipal ordinance section
 *
 * Represents a single section from a city's code of ordinances.
 */
export interface MunicipalOrdinance {
  /** City identifier (e.g., "houston") */
  cityId: string;
  /** Chapter number or identifier */
  chapter: string;
  /** Section number or identifier */
  section: string;
  /** Section heading/title */
  heading: string;
  /** Full text content */
  text: string;
  /** Subsections for lettered/numbered items */
  subsections: Array<{ id: string; text: string }>;
  /** Original source URL */
  sourceUrl: string;
  /** When this ordinance was scraped */
  scrapedAt: Date;
}

// ============================================================================
// Chunk Data (for embeddings)
// ============================================================================

/**
 * Chunked ordinance for vector embedding
 *
 * Follows same pattern as CFRChunk and TexasChunk.
 */
export interface MunicipalChunk {
  /** Unique chunk identifier */
  chunkId: string;
  /** City identifier */
  cityId: string;
  /** Chapter number */
  chapter: string;
  /** Section number */
  section: string;
  /** Chunk text content */
  text: string;
  /** Bluebook citation */
  citation: string;
  /** Navigation breadcrumbs */
  hierarchy: string[];
  /** Source URL */
  sourceUrl: string;
  /** Token count for this chunk */
  tokenCount: number;
}

// ============================================================================
// Pipeline State
// ============================================================================

/**
 * Pipeline checkpoint for resumption
 *
 * Tracks progress across all cities for fault-tolerant processing.
 */
export interface MunicipalCheckpoint {
  /** Last city that was being processed */
  lastProcessedCity?: string;
  /** Cities that completed successfully */
  processedCities: string[];
  /** ISO timestamp of last update */
  lastUpdated: string;
}

/**
 * Batch processing result
 *
 * Summary of a pipeline run across multiple cities.
 */
export interface MunicipalBatchResult {
  /** Cities processed successfully */
  successful: string[];
  /** Cities that failed with error details */
  failed: Array<{ city: string; error: string; timestamp: string }>;
  /** Cities skipped (disabled) */
  skipped: string[];
  /** Total Firecrawl credits used */
  totalCreditsUsed: number;
}
