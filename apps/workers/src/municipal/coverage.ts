/**
 * Municipal Coverage Report Generator
 *
 * Generates reports documenting processed vs skipped cities for
 * the Texas municipal data pipeline. Supports JSON and markdown output.
 *
 * Follows patterns from counties/coverage.ts for consistency.
 */

import { getEnabledCities, getSkippedCities } from './cities';
import type { MunicipalBatchPipelineResult, MunicipalPipelineResult } from './pipeline';

/**
 * Municipal coverage report structure
 */
export interface MunicipalCoverageReport {
  /** Report generation timestamp */
  generatedAt: string;
  /** Summary statistics */
  summary: {
    /** Total target cities (20 for Texas MVP) */
    targetCities: number;
    /** Cities with enabled sources */
    enabledCities: number;
    /** Cities that are disabled */
    skippedCities: number;
    /** Cities successfully processed */
    processedCities: number;
    /** Cities that failed processing */
    failedCities: number;
    /** Total ordinances fetched */
    totalOrdinances: number;
    /** Total vectors indexed in Pinecone */
    totalVectors: number;
    /** Total Firecrawl credits used */
    totalCreditsUsed: number;
  };
  /** Platform distribution */
  platforms: {
    municode: number;
    amlegal: number;
  };
  /** Enabled cities with processing status */
  enabled: Array<{
    name: string;
    cityId: string;
    platform: string;
    status: 'processed' | 'failed' | 'pending';
    ordinancesCount?: number;
    vectorsCount?: number;
    creditsUsed?: number;
    fromCache?: boolean;
    error?: string;
  }>;
  /** Skipped cities with reasons */
  skipped: Array<{
    name: string;
    cityId: string;
    reason: string;
  }>;
}

/**
 * Generate coverage report from pipeline results
 *
 * Creates a structured report documenting which cities were processed,
 * skipped, or failed. Can be called with or without pipeline results.
 *
 * @param pipelineResult Result from processAllCities (optional)
 * @returns Coverage report documenting all cities
 *
 * @example
 * ```typescript
 * // Generate report after pipeline run
 * const result = await processAllCities(env);
 * const report = generateMunicipalCoverageReport(result);
 *
 * // Generate report without pipeline results (shows current state)
 * const report = generateMunicipalCoverageReport();
 * ```
 */
export function generateMunicipalCoverageReport(
  pipelineResult?: MunicipalBatchPipelineResult
): MunicipalCoverageReport {
  const enabled = getEnabledCities();
  const skipped = getSkippedCities();

  // Map results by city name for lookup
  const resultsByCity = new Map<string, MunicipalPipelineResult>();
  if (pipelineResult) {
    for (const result of pipelineResult.successful) {
      resultsByCity.set(result.city, result);
    }
  }

  // Build failed cities map from pipeline result
  const failedCities = new Map<string, string>();
  if (pipelineResult) {
    for (const failed of pipelineResult.failed) {
      failedCities.set(failed.city, failed.error);
    }
  }

  const enabledWithStatus = enabled.map((city) => {
    const result = resultsByCity.get(city.name);
    const error = failedCities.get(city.name);

    return {
      name: city.name,
      cityId: city.cityId,
      platform: city.platform,
      status: result
        ? ('processed' as const)
        : error
          ? ('failed' as const)
          : ('pending' as const),
      ordinancesCount: result?.ordinancesProcessed,
      vectorsCount: result?.chunksIndexed,
      creditsUsed: result?.creditsUsed,
      fromCache: result?.fromCache,
      error,
    };
  });

  const skippedWithReason = skipped.map((city) => ({
    name: city.name,
    cityId: city.cityId,
    reason: city.skipReason || 'No reason specified',
  }));

  const processedCount = enabledWithStatus.filter(
    (c) => c.status === 'processed'
  ).length;
  const failedCount = enabledWithStatus.filter(
    (c) => c.status === 'failed'
  ).length;

  // Platform counts
  const platforms = {
    municode: enabled.filter((c) => c.platform === 'municode').length,
    amlegal: enabled.filter((c) => c.platform === 'amlegal').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      targetCities: 20,
      enabledCities: enabled.length,
      skippedCities: skipped.length,
      processedCities: processedCount,
      failedCities: failedCount,
      totalOrdinances: pipelineResult?.successful.reduce(
        (sum, r) => sum + r.ordinancesProcessed,
        0
      ) || 0,
      totalVectors: pipelineResult?.totalChunksIndexed || 0,
      totalCreditsUsed: pipelineResult?.totalCreditsUsed || 0,
    },
    platforms,
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
 * const report = generateMunicipalCoverageReport(pipelineResult);
 * const markdown = formatCoverageReportMarkdown(report);
 * console.log(markdown);
 * ```
 */
export function formatCoverageReportMarkdown(
  report: MunicipalCoverageReport
): string {
  const lines: string[] = [
    '# Texas Municipal Coverage Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    '| Metric | Count |',
    '|--------|-------|',
    `| Target Cities | ${report.summary.targetCities} |`,
    `| Enabled Cities | ${report.summary.enabledCities} |`,
    `| Skipped Cities | ${report.summary.skippedCities} |`,
    `| Processed Cities | ${report.summary.processedCities} |`,
    `| Failed Cities | ${report.summary.failedCities} |`,
    `| Total Ordinances | ${report.summary.totalOrdinances} |`,
    `| Total Vectors | ${report.summary.totalVectors} |`,
    `| Firecrawl Credits | ${report.summary.totalCreditsUsed} |`,
    '',
    '## Platform Distribution',
    '',
    '| Platform | Count |',
    '|----------|-------|',
    `| Municode | ${report.platforms.municode} |`,
    `| American Legal | ${report.platforms.amlegal} |`,
    '',
    '## Enabled Cities',
    '',
    '| City | ID | Platform | Status | Ordinances | Vectors | Credits | Cached |',
    '|------|----|----------|--------|------------|---------|---------|--------|',
  ];

  for (const city of report.enabled) {
    const ordinances = city.ordinancesCount ?? '-';
    const vectors = city.vectorsCount ?? '-';
    const credits = city.creditsUsed ?? '-';
    const cached = city.fromCache !== undefined ? (city.fromCache ? 'Yes' : 'No') : '-';
    const statusIcon =
      city.status === 'processed'
        ? 'active'
        : city.status === 'failed'
          ? 'error'
          : 'pending';
    lines.push(
      `| ${city.name} | ${city.cityId} | ${city.platform} | ${statusIcon} | ${ordinances} | ${vectors} | ${credits} | ${cached} |`
    );
  }

  if (report.skipped.length > 0) {
    lines.push('', '## Skipped Cities', '');
    lines.push('| City | ID | Reason |');
    lines.push('|------|-------|--------|');

    for (const city of report.skipped) {
      lines.push(`| ${city.name} | ${city.cityId} | ${city.reason} |`);
    }
  } else {
    lines.push('', '## Skipped Cities', '', 'None - all target cities enabled.');
  }

  // Add failed cities section if any failed
  const failedCities = report.enabled.filter((c) => c.status === 'failed');
  if (failedCities.length > 0) {
    lines.push('', '## Failed Cities', '');
    lines.push('| City | ID | Error |');
    lines.push('|------|-------|-------|');

    for (const city of failedCities) {
      lines.push(
        `| ${city.name} | ${city.cityId} | ${city.error || 'Unknown error'} |`
      );
    }
  }

  return lines.join('\n');
}
