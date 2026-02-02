/**
 * County Coverage Report Generator
 *
 * Generates reports documenting processed vs skipped counties for
 * the Texas county data pipeline. Supports JSON and markdown output.
 */

import { getEnabledCounties, getSkippedCounties } from './sources';
import type { CountyBatchPipelineResult, CountyPipelineResult } from './pipeline';

/**
 * County coverage report structure
 */
export interface CountyCoverageReport {
  /** Report generation timestamp */
  generatedAt: string;
  /** Summary statistics */
  summary: {
    /** Total target counties (10 for Texas MVP) */
    targetCounties: number;
    /** Counties with enabled sources */
    enabledCounties: number;
    /** Counties with no online source */
    skippedCounties: number;
    /** Counties successfully processed */
    processedCounties: number;
    /** Counties that failed processing */
    failedCounties: number;
    /** Total ordinances fetched */
    totalOrdinances: number;
    /** Total vectors indexed in Pinecone */
    totalVectors: number;
  };
  /** Enabled counties with processing status */
  enabled: Array<{
    name: string;
    fipsCode: string;
    platform: string;
    categories: string[];
    status: 'processed' | 'failed' | 'pending';
    ordinancesCount?: number;
    vectorsCount?: number;
    error?: string;
  }>;
  /** Skipped counties with reasons */
  skipped: Array<{
    name: string;
    fipsCode: string;
    reason: string;
  }>;
}

/**
 * Generate coverage report from pipeline results
 *
 * Creates a structured report documenting which counties were processed,
 * skipped, or failed. Can be called with or without pipeline results.
 *
 * @param pipelineResult Result from processAllCounties (optional)
 * @returns Coverage report documenting all counties
 *
 * @example
 * ```typescript
 * // Generate report after pipeline run
 * const result = await processAllCounties(env);
 * const report = generateCoverageReport(result);
 *
 * // Generate report without pipeline results (shows current state)
 * const report = generateCoverageReport();
 * ```
 */
export function generateCoverageReport(
  pipelineResult?: CountyBatchPipelineResult
): CountyCoverageReport {
  const enabled = getEnabledCounties();
  const skipped = getSkippedCounties();

  // Map results by county name for lookup
  const resultsByCounty = new Map<string, CountyPipelineResult>();
  if (pipelineResult) {
    for (const result of pipelineResult.results) {
      resultsByCounty.set(result.county, result);
    }
  }

  const enabledWithStatus = enabled.map((county) => {
    const result = resultsByCounty.get(county.name);

    return {
      name: county.name,
      fipsCode: county.fipsCode,
      platform: county.platform || 'unknown',
      categories: county.categories,
      status: result
        ? result.success
          ? ('processed' as const)
          : ('failed' as const)
        : ('pending' as const),
      ordinancesCount: result?.ordinancesProcessed,
      vectorsCount: result?.vectorsUpserted,
      error: result?.errors?.[0],
    };
  });

  const skippedWithReason = skipped.map((county) => ({
    name: county.name,
    fipsCode: county.fipsCode,
    reason: county.skipReason || 'No online source available',
  }));

  const processedCount = enabledWithStatus.filter(
    (c) => c.status === 'processed'
  ).length;
  const failedCount = enabledWithStatus.filter(
    (c) => c.status === 'failed'
  ).length;

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      targetCounties: 10,
      enabledCounties: enabled.length,
      skippedCounties: skipped.length,
      processedCounties: processedCount,
      failedCounties: failedCount,
      totalOrdinances: pipelineResult?.totalChunks || 0, // Use chunks as proxy
      totalVectors: pipelineResult?.totalVectors || 0,
    },
    enabled: enabledWithStatus,
    skipped: skippedWithReason,
  };
}

/**
 * Format coverage report as markdown for documentation
 *
 * Generates a human-readable markdown report suitable for
 * documentation or pipeline logs.
 *
 * @param report Coverage report to format
 * @returns Markdown-formatted report string
 *
 * @example
 * ```typescript
 * const report = generateCoverageReport(pipelineResult);
 * const markdown = formatCoverageReportMarkdown(report);
 * console.log(markdown);
 * ```
 */
export function formatCoverageReportMarkdown(
  report: CountyCoverageReport
): string {
  const lines: string[] = [
    '# Texas County Coverage Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|--------|-------|',
    `| Target Counties | ${report.summary.targetCounties} |`,
    `| Enabled Counties | ${report.summary.enabledCounties} |`,
    `| Skipped Counties | ${report.summary.skippedCounties} |`,
    `| Processed Counties | ${report.summary.processedCounties} |`,
    `| Failed Counties | ${report.summary.failedCounties} |`,
    `| Total Ordinances | ${report.summary.totalOrdinances} |`,
    `| Total Vectors | ${report.summary.totalVectors} |`,
    '',
    '## Enabled Counties',
    '',
    '| County | FIPS | Platform | Status | Ordinances | Vectors |',
    '|--------|------|----------|--------|------------|---------|',
  ];

  for (const county of report.enabled) {
    const ordinances = county.ordinancesCount ?? '-';
    const vectors = county.vectorsCount ?? '-';
    const statusIcon =
      county.status === 'processed'
        ? 'active'
        : county.status === 'failed'
          ? 'error'
          : 'pending';
    lines.push(
      `| ${county.name} | ${county.fipsCode} | ${county.platform} | ${statusIcon} | ${ordinances} | ${vectors} |`
    );
  }

  if (report.skipped.length > 0) {
    lines.push('', '## Skipped Counties', '');
    lines.push('| County | FIPS | Reason |');
    lines.push('|--------|------|--------|');

    for (const county of report.skipped) {
      lines.push(`| ${county.name} | ${county.fipsCode} | ${county.reason} |`);
    }
  } else {
    lines.push('', '## Skipped Counties', '', 'None - all target counties enabled.');
  }

  // Add failed counties section if any failed
  const failedCounties = report.enabled.filter((c) => c.status === 'failed');
  if (failedCounties.length > 0) {
    lines.push('', '## Failed Counties', '');
    lines.push('| County | FIPS | Error |');
    lines.push('|--------|------|-------|');

    for (const county of failedCounties) {
      lines.push(
        `| ${county.name} | ${county.fipsCode} | ${county.error || 'Unknown error'} |`
      );
    }
  }

  return lines.join('\n');
}
