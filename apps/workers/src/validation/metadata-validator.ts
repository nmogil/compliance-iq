import type { ChunkMetadata } from '../pinecone';

/**
 * Result of validating a single chunk's metadata.
 */
export interface MetadataValidationResult {
  /** Whether all required fields are present and non-empty */
  valid: boolean;
  /** List of required fields that are missing or empty */
  missingRequired: string[];
  /** Warnings for missing optional but recommended fields */
  warnings: string[];
}

/**
 * Completeness statistics for optional metadata fields across chunks.
 */
export interface MetadataCompleteness {
  /** Number of chunks with category field */
  hasCategory: number;
  /** Number of chunks with title field */
  hasTitle: number;
  /** Number of chunks with lastUpdated field */
  hasLastUpdated: number;
}

/**
 * Citation coverage statistics across chunks.
 */
export interface CitationCoverageResult {
  /** Total number of chunks analyzed */
  totalChunks: number;
  /** Number of chunks with valid citations */
  withCitation: number;
  /** Percentage of chunks with citations (0-100) */
  coveragePercent: number;
  /** Array of chunkIds missing citations */
  missingCitations: string[];
}

/**
 * Validation result for an array of chunk metadata.
 */
export interface MetadataArrayValidation {
  /** Total number of chunks analyzed */
  totalChunks: number;
  /** Number of chunks with valid metadata */
  validChunks: number;
  /** Details of chunks with validation issues */
  invalidChunks: Array<{
    chunkId: string;
    issues: string[];
  }>;
}

/**
 * Distribution of chunks by sourceType.
 */
export interface SourceTypeDistribution {
  /** Number of federal chunks */
  federal: number;
  /** Number of state chunks */
  state: number;
  /** Number of county chunks */
  county: number;
  /** Number of municipal chunks */
  municipal: number;
}

/**
 * Validate a single chunk's metadata for completeness.
 *
 * Required fields (must be non-empty):
 * - chunkId
 * - sourceId
 * - sourceType
 * - jurisdiction
 * - text
 * - citation
 * - indexedAt
 *
 * Optional but recommended fields:
 * - title
 * - category
 * - lastUpdated
 *
 * @param metadata Chunk metadata to validate
 * @returns Validation result with missing fields and warnings
 */
export function validateMetadata(
  metadata: ChunkMetadata
): MetadataValidationResult {
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  const requiredFields: Array<keyof ChunkMetadata> = [
    'chunkId',
    'sourceId',
    'sourceType',
    'jurisdiction',
    'text',
    'citation',
    'indexedAt',
  ];

  for (const field of requiredFields) {
    const value = metadata[field];
    if (value === undefined || value === null || value === '') {
      missingRequired.push(field);
    }
  }

  // Check optional but recommended fields
  const optionalFields: Array<keyof ChunkMetadata> = [
    'title',
    'category',
    'lastUpdated',
  ];

  for (const field of optionalFields) {
    const value = metadata[field];
    if (value === undefined || value === null || value === '') {
      warnings.push(`Optional field '${field}' is empty`);
    }
  }

  return {
    valid: missingRequired.length === 0,
    missingRequired,
    warnings,
  };
}

/**
 * Calculate completeness statistics for optional metadata fields.
 *
 * Counts how many chunks in the array have each optional field populated.
 *
 * @param metadataArray Array of chunk metadata to analyze
 * @returns Raw counts for each optional field (caller can convert to percentage)
 */
export function getMetadataCompleteness(
  metadataArray: ChunkMetadata[]
): MetadataCompleteness {
  let hasCategory = 0;
  let hasTitle = 0;
  let hasLastUpdated = 0;

  for (const metadata of metadataArray) {
    if (
      metadata.category !== undefined &&
      metadata.category !== null &&
      metadata.category !== ''
    ) {
      hasCategory++;
    }

    if (
      metadata.title !== undefined &&
      metadata.title !== null &&
      metadata.title !== ''
    ) {
      hasTitle++;
    }

    if (
      metadata.lastUpdated !== undefined &&
      metadata.lastUpdated !== null &&
      metadata.lastUpdated !== ''
    ) {
      hasLastUpdated++;
    }
  }

  return {
    hasCategory,
    hasTitle,
    hasLastUpdated,
  };
}

/**
 * Check citation coverage across chunks.
 *
 * A valid citation is a non-empty string. This identifies chunks
 * that are missing proper citation references.
 *
 * @param metadataArray Array of chunk metadata to analyze
 * @returns Citation coverage statistics with list of problematic chunks
 */
export function checkCitationCoverage(
  metadataArray: ChunkMetadata[]
): CitationCoverageResult {
  const totalChunks = metadataArray.length;
  let withCitation = 0;
  const missingCitations: string[] = [];

  for (const metadata of metadataArray) {
    const hasCitation =
      metadata.citation !== undefined &&
      metadata.citation !== null &&
      metadata.citation !== '';

    if (hasCitation) {
      withCitation++;
    } else {
      missingCitations.push(metadata.chunkId || 'unknown');
    }
  }

  const coveragePercent =
    totalChunks > 0 ? (withCitation / totalChunks) * 100 : 0;

  return {
    totalChunks,
    withCitation,
    coveragePercent,
    missingCitations,
  };
}

/**
 * Validate an array of chunk metadata and collect all issues.
 *
 * Provides a summary of validation results across all chunks,
 * including detailed issues for each problematic chunk.
 *
 * @param metadataArray Array of chunk metadata to validate
 * @returns Validation summary with list of invalid chunks and their issues
 */
export function validateMetadataArray(
  metadataArray: ChunkMetadata[]
): MetadataArrayValidation {
  const totalChunks = metadataArray.length;
  let validChunks = 0;
  const invalidChunks: Array<{ chunkId: string; issues: string[] }> = [];

  for (const metadata of metadataArray) {
    const result = validateMetadata(metadata);

    if (result.valid) {
      validChunks++;
    } else {
      invalidChunks.push({
        chunkId: metadata.chunkId || 'unknown',
        issues: result.missingRequired.map(
          (field) => `Missing required field: ${field}`
        ),
      });
    }
  }

  return {
    totalChunks,
    validChunks,
    invalidChunks,
  };
}

/**
 * Check sourceType distribution across chunks.
 *
 * Counts chunks by sourceType to verify expected distribution
 * across federal, state, county, and municipal sources.
 *
 * @param metadataArray Array of chunk metadata to analyze
 * @returns Count of chunks for each sourceType
 */
export function checkSourceTypeDistribution(
  metadataArray: ChunkMetadata[]
): SourceTypeDistribution {
  const distribution: SourceTypeDistribution = {
    federal: 0,
    state: 0,
    county: 0,
    municipal: 0,
  };

  for (const metadata of metadataArray) {
    const sourceType = metadata.sourceType;
    if (sourceType && sourceType in distribution) {
      distribution[sourceType]++;
    }
  }

  return distribution;
}
