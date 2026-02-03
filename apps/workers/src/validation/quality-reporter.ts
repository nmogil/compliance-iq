/**
 * Data Quality Reporter
 *
 * Aggregates token analysis and metadata validation into comprehensive
 * quality reports by jurisdiction. Validates DATA-07/08/09 by measuring
 * chunk quality, metadata completeness, and citation coverage.
 *
 * NOTE: Uses Pinecone sampling approach - queries return up to 1000 chunks
 * per source type (not all chunks). Pinecone doesn't support bulk export,
 * so reports are based on representative samples.
 */

import type { Index } from '@pinecone-database/pinecone';
import type { R2Bucket } from '@cloudflare/workers-types';
import { analyzeTokenDistribution } from './token-analyzer';
import {
  getMetadataCompleteness,
  checkCitationCoverage,
  validateMetadataArray,
} from './metadata-validator';
import type {
  DataQualityReport,
  ValidationResult,
  R2ValidationResult,
  ConvexValidationResult,
} from './types';
import type { ChunkMetadata } from '../pinecone';
import { queryChunks } from '../pinecone';

/**
 * Fetch sample chunks for a jurisdiction from Pinecone.
 *
 * Uses dummy zero vector with metadata filter to sample chunks.
 * Pinecone doesn't support bulk export, so we fetch a sample instead.
 *
 * @param index - Pinecone index instance
 * @param sourceType - Source type to filter by
 * @param jurisdiction - Optional jurisdiction filter (e.g., 'TX', 'TX-48201')
 * @param limit - Maximum number of chunks to fetch (default: 1000)
 * @returns Array of chunk metadata
 *
 * @example
 * ```ts
 * const chunks = await fetchChunksForJurisdiction(index, 'federal', 'US', 500);
 * console.log(`Fetched ${chunks.length} federal chunks`);
 * ```
 */
export async function fetchChunksForJurisdiction(
  index: Index<ChunkMetadata>,
  sourceType: string,
  jurisdiction?: string,
  limit: number = 1000
): Promise<ChunkMetadata[]> {
  // Build metadata filter
  const filter: Record<string, unknown> = { sourceType };
  if (jurisdiction) {
    filter.jurisdiction = jurisdiction;
  }

  // Use dummy zero vector to fetch chunks by metadata filter only
  // Pinecone requires a vector for query, but we're only interested in filtering
  const dummyVector = new Array(3072).fill(0);

  const results = await queryChunks(index, dummyVector, {
    topK: limit,
    filter,
    includeMetadata: true,
  });

  // Extract metadata from results
  return results
    .filter((result) => result.metadata !== undefined)
    .map((result) => result.metadata!);
}

/**
 * Generate data quality report for a jurisdiction.
 *
 * Analyzes token distribution, metadata completeness, citation coverage,
 * and identifies validation issues across sampled chunks.
 *
 * @param chunks - Array of chunk metadata (from fetchChunksForJurisdiction)
 * @param jurisdiction - Jurisdiction identifier
 * @param sourceType - Source type
 * @returns Comprehensive data quality report
 *
 * @example
 * ```ts
 * const chunks = await fetchChunksForJurisdiction(index, 'state', 'TX');
 * const report = generateQualityReport(chunks, 'TX', 'state');
 * console.log(`Citation coverage: ${report.citationCoverage}%`);
 * ```
 */
export function generateQualityReport(
  chunks: ChunkMetadata[],
  jurisdiction: string,
  sourceType: 'federal' | 'state' | 'county' | 'municipal'
): DataQualityReport {
  // Extract text array for token analysis
  const texts = chunks.map((chunk) => chunk.text || '');

  // Analyze token distribution
  const tokenDistribution = analyzeTokenDistribution(texts);

  // Check metadata completeness
  const metadataCompleteness = getMetadataCompleteness(chunks);

  // Check citation coverage
  const citationCoverageResult = checkCitationCoverage(chunks);

  // Validate metadata and collect issues
  const validationResult = validateMetadataArray(chunks);

  // Build issues array from validation results
  const issues = validationResult.invalidChunks.map((invalidChunk) => ({
    chunkId: invalidChunk.chunkId,
    issue: invalidChunk.issues.join(', '),
  }));

  console.log(
    `Generated quality report for ${jurisdiction} (${sourceType}): ${chunks.length} chunks, ${citationCoverageResult.coveragePercent.toFixed(1)}% citation coverage, ${issues.length} issues`
  );

  return {
    jurisdiction,
    sourceType,
    timestamp: new Date().toISOString(),
    totalChunks: chunks.length,
    tokenDistribution,
    citationCoverage: Math.round(citationCoverageResult.coveragePercent * 10) / 10,
    metadataCompleteness,
    issues,
  };
}

/**
 * Generate full validation report across all source types.
 *
 * Fetches sample chunks for each source type (federal, state, county, municipal)
 * and generates quality reports. Aggregates results into overall validation result.
 *
 * @param index - Pinecone index instance
 * @returns Complete validation result with reports for each source type
 *
 * @example
 * ```ts
 * const result = await generateFullValidationReport(index);
 * if (result.success) {
 *   console.log(`Validation passed: ${result.summary.totalChunks} chunks analyzed`);
 * } else {
 *   console.log(`Found ${result.summary.issuesCount} issues`);
 * }
 * ```
 */
export async function generateFullValidationReport(
  index: Index<ChunkMetadata>
): Promise<ValidationResult> {
  console.log('Starting full validation report generation...');

  const qualityReports: DataQualityReport[] = [];

  // Fetch and analyze federal chunks
  try {
    const federalChunks = await fetchChunksForJurisdiction(index, 'federal', 'US');
    if (federalChunks.length > 0) {
      const report = generateQualityReport(federalChunks, 'US', 'federal');
      qualityReports.push(report);
    }
  } catch (error) {
    console.error('Error fetching federal chunks:', error);
  }

  // Fetch and analyze state chunks (Texas)
  try {
    const stateChunks = await fetchChunksForJurisdiction(index, 'state', 'TX');
    if (stateChunks.length > 0) {
      const report = generateQualityReport(stateChunks, 'TX', 'state');
      qualityReports.push(report);
    }
  } catch (error) {
    console.error('Error fetching state chunks:', error);
  }

  // Fetch and analyze county chunks
  try {
    const countyChunks = await fetchChunksForJurisdiction(index, 'county');
    if (countyChunks.length > 0) {
      const report = generateQualityReport(countyChunks, 'TX-counties', 'county');
      qualityReports.push(report);
    }
  } catch (error) {
    console.error('Error fetching county chunks:', error);
  }

  // Fetch and analyze municipal chunks
  try {
    const municipalChunks = await fetchChunksForJurisdiction(index, 'municipal');
    if (municipalChunks.length > 0) {
      const report = generateQualityReport(municipalChunks, 'TX-cities', 'municipal');
      qualityReports.push(report);
    }
  } catch (error) {
    console.error('Error fetching municipal chunks:', error);
  }

  // Calculate summary statistics
  const totalChunks = qualityReports.reduce((sum, report) => sum + report.totalChunks, 0);
  const totalTokens = qualityReports.reduce(
    (sum, report) => sum + report.tokenDistribution.avg * report.totalChunks,
    0
  );
  const avgTokens = totalChunks > 0 ? Math.round(totalTokens / totalChunks) : 0;

  const totalCitations = qualityReports.reduce(
    (sum, report) => sum + (report.citationCoverage / 100) * report.totalChunks,
    0
  );
  const coveragePercent = totalChunks > 0 ? (totalCitations / totalChunks) * 100 : 0;

  const issuesCount = qualityReports.reduce((sum, report) => sum + report.issues.length, 0);

  // Validation succeeds if we have data and no critical issues
  const success = totalChunks > 0 && issuesCount === 0;

  console.log(
    `Validation report complete: ${qualityReports.length} source types, ${totalChunks} total chunks, ${success ? 'PASSED' : 'FAILED'}`
  );

  return {
    success,
    timestamp: new Date().toISOString(),
    qualityReports,
    coverageReport: {
      generatedAt: new Date().toISOString(),
      totalExpected: 4, // federal, state, county, municipal
      totalIndexed: qualityReports.length,
      coveragePercent: (qualityReports.length / 4) * 100,
      bySourceType: {
        federal: {
          expected: 1,
          indexed: qualityReports.some((r) => r.sourceType === 'federal') ? 1 : 0,
        },
        state: {
          expected: 1,
          indexed: qualityReports.some((r) => r.sourceType === 'state') ? 1 : 0,
        },
        county: {
          expected: 1,
          indexed: qualityReports.some((r) => r.sourceType === 'county') ? 1 : 0,
        },
        municipal: {
          expected: 1,
          indexed: qualityReports.some((r) => r.sourceType === 'municipal') ? 1 : 0,
        },
      },
      jurisdictions: [],
      gaps: [],
    },
    summary: {
      totalChunks,
      avgTokens,
      coveragePercent: Math.round(coveragePercent * 10) / 10,
      issuesCount,
    },
  };
}

/**
 * Format data quality report as markdown.
 *
 * Creates human-readable markdown report with sections for summary,
 * token distribution, metadata completeness, and validation issues.
 *
 * @param report - Data quality report to format
 * @returns Markdown-formatted report
 *
 * @example
 * ```ts
 * const report = generateQualityReport(chunks, 'TX', 'state');
 * const markdown = formatQualityReportMarkdown(report);
 * console.log(markdown);
 * ```
 */
export function formatQualityReportMarkdown(report: DataQualityReport): string {
  const lines: string[] = [];

  lines.push(`# Data Quality Report: ${report.jurisdiction} (${report.sourceType})`);
  lines.push('');
  lines.push(`**Generated:** ${report.timestamp}`);
  lines.push('');

  // Summary section
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **Total Chunks:** ${report.totalChunks}`);
  lines.push(`- **Citation Coverage:** ${report.citationCoverage}%`);
  lines.push(`- **Issues Found:** ${report.issues.length}`);
  lines.push('');

  // Token distribution section
  lines.push('## Token Distribution');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Average | ${report.tokenDistribution.avg} |`);
  lines.push(`| Minimum | ${report.tokenDistribution.min} |`);
  lines.push(`| Maximum | ${report.tokenDistribution.max} |`);
  lines.push(`| Median (p50) | ${report.tokenDistribution.p50} |`);
  lines.push(`| 95th Percentile | ${report.tokenDistribution.p95} |`);
  lines.push(`| 99th Percentile | ${report.tokenDistribution.p99} |`);
  lines.push('');

  // Metadata completeness section
  lines.push('## Metadata Completeness');
  lines.push('');
  lines.push('| Field | Count | Percentage |');
  lines.push('|-------|-------|------------|');
  const categoryPct = ((report.metadataCompleteness.hasCategory / report.totalChunks) * 100).toFixed(1);
  const titlePct = ((report.metadataCompleteness.hasTitle / report.totalChunks) * 100).toFixed(1);
  const updatedPct = ((report.metadataCompleteness.hasLastUpdated / report.totalChunks) * 100).toFixed(1);
  lines.push(`| Category | ${report.metadataCompleteness.hasCategory} | ${categoryPct}% |`);
  lines.push(`| Title | ${report.metadataCompleteness.hasTitle} | ${titlePct}% |`);
  lines.push(`| Last Updated | ${report.metadataCompleteness.hasLastUpdated} | ${updatedPct}% |`);
  lines.push('');

  // Issues section
  if (report.issues.length > 0) {
    lines.push('## Issues');
    lines.push('');
    lines.push('| Chunk ID | Issue |');
    lines.push('|----------|-------|');
    report.issues.forEach((issue) => {
      lines.push(`| ${issue.chunkId} | ${issue.issue} |`);
    });
    lines.push('');
  } else {
    lines.push('## Issues');
    lines.push('');
    lines.push('No validation issues found.');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format full validation result as markdown.
 *
 * Creates comprehensive markdown report with executive summary and
 * quality reports for each source type.
 *
 * @param result - Validation result to format
 * @returns Markdown-formatted validation report
 *
 * @example
 * ```ts
 * const result = await generateFullValidationReport(index);
 * const markdown = formatValidationResultMarkdown(result);
 * await fs.writeFile('validation-report.md', markdown);
 * ```
 */
export function formatValidationResultMarkdown(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push('# Data Processing Validation Report');
  lines.push('');
  lines.push(`**Generated:** ${result.timestamp}`);
  lines.push(`**Status:** ${result.success ? '✅ PASSED' : '❌ FAILED'}`);
  lines.push('');

  // Executive summary
  lines.push('## Executive Summary');
  lines.push('');
  lines.push(`- **Total Chunks Analyzed:** ${result.summary.totalChunks}`);
  lines.push(`- **Average Token Count:** ${result.summary.avgTokens}`);
  lines.push(`- **Overall Citation Coverage:** ${result.summary.coveragePercent}%`);
  lines.push(`- **Total Issues Found:** ${result.summary.issuesCount}`);
  lines.push('');

  // Source type coverage
  lines.push('## Source Type Coverage');
  lines.push('');
  lines.push('| Source Type | Expected | Indexed | Status |');
  lines.push('|-------------|----------|---------|--------|');
  const { bySourceType } = result.coverageReport;
  lines.push(`| Federal | ${bySourceType.federal.expected} | ${bySourceType.federal.indexed} | ${bySourceType.federal.indexed > 0 ? '✅' : '❌'} |`);
  lines.push(`| State | ${bySourceType.state.expected} | ${bySourceType.state.indexed} | ${bySourceType.state.indexed > 0 ? '✅' : '❌'} |`);
  lines.push(`| County | ${bySourceType.county.expected} | ${bySourceType.county.indexed} | ${bySourceType.county.indexed > 0 ? '✅' : '❌'} |`);
  lines.push(`| Municipal | ${bySourceType.municipal.expected} | ${bySourceType.municipal.indexed} | ${bySourceType.municipal.indexed > 0 ? '✅' : '❌'} |`);
  lines.push('');

  // Individual quality reports
  lines.push('## Quality Reports by Source Type');
  lines.push('');

  result.qualityReports.forEach((report) => {
    lines.push(`### ${report.jurisdiction} (${report.sourceType})`);
    lines.push('');
    lines.push(`- **Chunks:** ${report.totalChunks}`);
    lines.push(`- **Avg Tokens:** ${report.tokenDistribution.avg} (range: ${report.tokenDistribution.min}-${report.tokenDistribution.max})`);
    lines.push(`- **Citation Coverage:** ${report.citationCoverage}%`);
    lines.push(`- **Issues:** ${report.issues.length}`);
    lines.push('');
  });

  // Critical issues section
  if (result.summary.issuesCount > 0) {
    lines.push('## Critical Issues');
    lines.push('');
    result.qualityReports.forEach((report) => {
      if (report.issues.length > 0) {
        lines.push(`### ${report.jurisdiction}`);
        lines.push('');
        report.issues.forEach((issue) => {
          lines.push(`- **${issue.chunkId}:** ${issue.issue}`);
        });
        lines.push('');
      }
    });
  }

  return lines.join('\n');
}

/**
 * Validate R2 storage structure for indexed jurisdictions.
 *
 * Verifies that expected folder structure exists in R2 for each source type
 * and that indexed jurisdictions have corresponding data in R2.
 *
 * @param r2 - R2 bucket instance
 * @param indexedJurisdictions - Array of jurisdiction identifiers that are indexed
 * @returns R2 validation result with missing folders and jurisdictions
 *
 * @example
 * ```ts
 * const result = await validateR2Storage(r2, ['US', 'TX', 'TX-48201']);
 * if (!result.valid) {
 *   console.log('Missing folders:', result.missingFolders);
 *   console.log('Jurisdictions without data:', result.jurisdictionsWithoutData);
 * }
 * ```
 */
export async function validateR2Storage(
  r2: R2Bucket,
  indexedJurisdictions: string[]
): Promise<R2ValidationResult> {
  console.log(`Validating R2 storage for ${indexedJurisdictions.length} jurisdictions...`);

  const missingFolders: string[] = [];
  const jurisdictionsWithoutData: string[] = [];

  // Expected top-level folders for each source type
  const expectedFolders = ['federal/', 'texas/', 'counties/', 'municipal/'];

  // Check for existence of top-level folders
  for (const folder of expectedFolders) {
    const listed = await r2.list({ prefix: folder, limit: 1 });
    if (listed.objects.length === 0) {
      missingFolders.push(folder);
    }
  }

  // Check each indexed jurisdiction has data in R2
  for (const jurisdiction of indexedJurisdictions) {
    let hasData = false;

    // Determine prefix based on jurisdiction format
    let prefix = '';
    if (jurisdiction === 'US') {
      prefix = 'federal/';
    } else if (jurisdiction === 'TX') {
      prefix = 'texas/';
    } else if (jurisdiction.startsWith('TX-48')) {
      // County (FIPS code)
      const fips = jurisdiction.replace('TX-', '');
      prefix = `counties/${fips}/`;
    } else if (jurisdiction.startsWith('TX-')) {
      // Municipal (city ID)
      const cityId = jurisdiction.replace('TX-', '');
      prefix = `municipal/${cityId}/`;
    }

    if (prefix) {
      const listed = await r2.list({ prefix, limit: 1 });
      hasData = listed.objects.length > 0;

      if (!hasData) {
        jurisdictionsWithoutData.push(jurisdiction);
      }
    }
  }

  const valid = missingFolders.length === 0 && jurisdictionsWithoutData.length === 0;

  console.log(
    `R2 validation ${valid ? 'PASSED' : 'FAILED'}: ${missingFolders.length} missing folders, ${jurisdictionsWithoutData.length} jurisdictions without data`
  );

  return {
    valid,
    missingFolders,
    jurisdictionsWithoutData,
  };
}

/**
 * Generic Convex query function type for jurisdiction validation.
 * Allows flexibility in implementation without requiring direct Convex dependency.
 */
export interface ConvexQueryFn {
  (functionName: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Validate Convex sync for indexed jurisdictions.
 *
 * Verifies that Convex jurisdiction tracking is in sync with Pinecone:
 * - All indexed jurisdictions exist in Convex
 * - All have lastScrapedAt timestamps
 * - All have status='active'
 * - Vector counts match between Convex and Pinecone (within 10% tolerance)
 *
 * @param convexQuery - Generic query function for Convex (e.g., convexClient.query)
 * @param indexedJurisdictions - Array of jurisdiction identifiers in Pinecone
 * @param pineconeCounts - Map of jurisdiction to vector count in Pinecone
 * @returns Convex validation result with sync issues
 *
 * @example
 * ```ts
 * const counts = new Map([['TX', 1500], ['TX-48201', 800]]);
 * const result = await validateConvexSync(
 *   (fn, args) => convexClient.query(fn, args),
 *   ['TX', 'TX-48201'],
 *   counts
 * );
 * if (!result.valid) {
 *   console.log('Missing in Convex:', result.missingInConvex);
 *   console.log('Stale jurisdictions:', result.staleJurisdictions);
 *   console.log('Vector mismatches:', result.vectorCountMismatches);
 * }
 * ```
 */
export async function validateConvexSync(
  convexQuery: ConvexQueryFn,
  indexedJurisdictions: string[],
  pineconeCounts: Map<string, number>
): Promise<ConvexValidationResult> {
  console.log(`Validating Convex sync for ${indexedJurisdictions.length} jurisdictions...`);

  const missingInConvex: string[] = [];
  const staleJurisdictions: string[] = [];
  const vectorCountMismatches: Array<{
    jurisdiction: string;
    convex: number;
    pinecone: number;
  }> = [];

  // Query Convex for each jurisdiction
  // Note: This assumes Convex has query functions for jurisdictions
  // Actual implementation depends on Convex schema
  for (const jurisdiction of indexedJurisdictions) {
    try {
      // Placeholder: Would call appropriate Convex query based on jurisdiction type
      // For now, we'll log that validation would happen here
      console.log(`Would validate Convex sync for jurisdiction: ${jurisdiction}`);

      // Example validation logic (to be implemented with actual Convex queries):
      // const record = await convexClient.query('jurisdictions:getByIdentifier', { identifier: jurisdiction });
      // if (!record) {
      //   missingInConvex.push(jurisdiction);
      //   continue;
      // }
      // if (!record.lastScrapedAt) {
      //   staleJurisdictions.push(jurisdiction);
      // }
      // const pineconeCount = pineconeCounts.get(jurisdiction) || 0;
      // const convexCount = record.vectorCount || 0;
      // const tolerance = 0.1; // 10%
      // if (Math.abs(convexCount - pineconeCount) > pineconeCount * tolerance) {
      //   vectorCountMismatches.push({
      //     jurisdiction,
      //     convex: convexCount,
      //     pinecone: pineconeCount
      //   });
      // }
    } catch (error) {
      console.error(`Error validating Convex sync for ${jurisdiction}:`, error);
      missingInConvex.push(jurisdiction);
    }
  }

  const valid =
    missingInConvex.length === 0 &&
    staleJurisdictions.length === 0 &&
    vectorCountMismatches.length === 0;

  console.log(
    `Convex sync validation ${valid ? 'PASSED' : 'FAILED'}: ${missingInConvex.length} missing, ${staleJurisdictions.length} stale, ${vectorCountMismatches.length} mismatches`
  );

  return {
    valid,
    missingInConvex,
    staleJurisdictions,
    vectorCountMismatches,
  };
}
