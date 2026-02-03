#!/usr/bin/env tsx
/**
 * Pipeline Validation Script
 *
 * Runs full validation suite against Pinecone index and outputs reports.
 *
 * Usage:
 *   pnpm exec tsx scripts/validate-pipeline.ts
 *   pnpm exec tsx scripts/validate-pipeline.ts --format=markdown
 *   pnpm exec tsx scripts/validate-pipeline.ts --coverage-only
 *   pnpm exec tsx scripts/validate-pipeline.ts --output=report.md
 *
 * Environment:
 *   PINECONE_API_KEY - Required
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import {
  checkCoverage,
  generateFullValidationReport,
  formatValidationResultMarkdown,
  identifyGaps,
} from '../apps/workers/src/validation';

const INDEX_NAME = 'compliance-embeddings';

interface ParsedArgs {
  format: 'json' | 'markdown';
  coverageOnly: boolean;
  output?: string;
  help: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const parsed: ParsedArgs = {
    format: 'json',
    coverageOnly: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg.startsWith('--format=')) {
      const format = arg.split('=')[1];
      if (format === 'json' || format === 'markdown') {
        parsed.format = format;
      } else {
        console.error(`Invalid format: ${format}. Must be 'json' or 'markdown'`);
        process.exit(1);
      }
    } else if (arg === '--coverage-only') {
      parsed.coverageOnly = true;
    } else if (arg.startsWith('--output=')) {
      parsed.output = arg.split('=')[1];
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return parsed;
}

/**
 * Print usage information
 */
function printHelp(): void {
  console.log(`
Pipeline Validation Script

Usage:
  pnpm exec tsx scripts/validate-pipeline.ts [options]

Options:
  --format=<json|markdown>  Output format (default: json)
  --coverage-only           Run coverage check only (skip quality analysis)
  --output=<filename>       Write report to file instead of stdout
  --help, -h                Show this help message

Environment Variables:
  PINECONE_API_KEY          Required - Pinecone API key for querying index

Examples:
  # Run full validation and output JSON
  pnpm exec tsx scripts/validate-pipeline.ts

  # Generate markdown report
  pnpm exec tsx scripts/validate-pipeline.ts --format=markdown

  # Check coverage only
  pnpm exec tsx scripts/validate-pipeline.ts --coverage-only

  # Save report to file
  pnpm exec tsx scripts/validate-pipeline.ts --format=markdown --output=validation-report.md
`);
}

/**
 * Main validation function
 */
async function runValidation() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log('[Validation] Pipeline Validation Script');
  console.log('='.repeat(50));

  // Load environment variables
  config();

  // Validate environment
  if (!process.env.PINECONE_API_KEY) {
    console.error('[Validation] ERROR: PINECONE_API_KEY environment variable required');
    console.error('[Validation] Set it in .env file or export it before running this script');
    process.exit(1);
  }

  // Record start time
  const startTime = Date.now();
  console.log(`[Validation] Start time: ${new Date().toISOString()}`);

  try {
    // Initialize Pinecone
    console.log('[Validation] Initializing Pinecone client...');
    const pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });

    const index = pinecone.index(INDEX_NAME);
    console.log(`[Validation] Connected to index: ${INDEX_NAME}`);

    // Check index stats
    console.log('[Validation] Checking index stats...');
    const stats = await index.describeIndexStats();
    console.log(`[Validation] Total vectors in index: ${stats.totalRecordCount}`);

    if (!stats.totalRecordCount || stats.totalRecordCount === 0) {
      console.warn('[Validation] WARNING: Index is empty. Run pipelines to populate data first.');
    }

    let outputContent: string;

    if (args.coverageOnly) {
      // Run coverage check only
      console.log('\n[Validation] Running coverage check...');
      const coverageReport = await checkCoverage(index as any);
      const gaps = identifyGaps(coverageReport);

      const duration = Date.now() - startTime;

      // Log summary
      console.log('\n[Validation] Coverage Summary:');
      console.log(`  Total expected: ${coverageReport.totalExpected}`);
      console.log(`  Total indexed: ${coverageReport.totalIndexed}`);
      console.log(`  Coverage: ${coverageReport.coveragePercent.toFixed(2)}%`);
      console.log(`  Gaps: ${gaps.length}`);
      console.log(`  Duration: ${duration}ms`);

      if (gaps.length > 0) {
        console.log('\n[Validation] Missing jurisdictions:');
        gaps.forEach((gap) => {
          console.log(`  - ${gap.jurisdiction} (${gap.sourceType}): ${gap.reason}`);
        });
      }

      // Format output
      if (args.format === 'json') {
        outputContent = JSON.stringify(
          {
            coverageReport,
            gaps,
            durationMs: duration,
          },
          null,
          2
        );
      } else {
        // Markdown format for coverage
        const lines: string[] = [];
        lines.push('# Pipeline Coverage Report');
        lines.push('');
        lines.push(`**Generated:** ${coverageReport.generatedAt}`);
        lines.push(`**Duration:** ${duration}ms`);
        lines.push('');
        lines.push('## Summary');
        lines.push('');
        lines.push(`- **Total Expected:** ${coverageReport.totalExpected}`);
        lines.push(`- **Total Indexed:** ${coverageReport.totalIndexed}`);
        lines.push(`- **Coverage:** ${coverageReport.coveragePercent.toFixed(2)}%`);
        lines.push('');
        lines.push('## Coverage by Source Type');
        lines.push('');
        lines.push('| Source Type | Expected | Indexed | Coverage |');
        lines.push('|-------------|----------|---------|----------|');
        const { bySourceType } = coverageReport;
        lines.push(
          `| Federal | ${bySourceType.federal.expected} | ${bySourceType.federal.indexed} | ${bySourceType.federal.expected > 0 ? ((bySourceType.federal.indexed / bySourceType.federal.expected) * 100).toFixed(1) : 0}% |`
        );
        lines.push(
          `| State | ${bySourceType.state.expected} | ${bySourceType.state.indexed} | ${bySourceType.state.expected > 0 ? ((bySourceType.state.indexed / bySourceType.state.expected) * 100).toFixed(1) : 0}% |`
        );
        lines.push(
          `| County | ${bySourceType.county.expected} | ${bySourceType.county.indexed} | ${bySourceType.county.expected > 0 ? ((bySourceType.county.indexed / bySourceType.county.expected) * 100).toFixed(1) : 0}% |`
        );
        lines.push(
          `| Municipal | ${bySourceType.municipal.expected} | ${bySourceType.municipal.indexed} | ${bySourceType.municipal.expected > 0 ? ((bySourceType.municipal.indexed / bySourceType.municipal.expected) * 100).toFixed(1) : 0}% |`
        );
        lines.push('');

        if (gaps.length > 0) {
          lines.push('## Missing Jurisdictions');
          lines.push('');
          lines.push('| Jurisdiction | Source Type | Reason |');
          lines.push('|--------------|-------------|--------|');
          gaps.forEach((gap) => {
            lines.push(`| ${gap.jurisdiction} | ${gap.sourceType} | ${gap.reason} |`);
          });
          lines.push('');
        } else {
          lines.push('## Missing Jurisdictions');
          lines.push('');
          lines.push('✅ No gaps - all expected jurisdictions are indexed!');
          lines.push('');
        }

        outputContent = lines.join('\n');
      }
    } else {
      // Run full validation (coverage + quality)
      console.log('\n[Validation] Running full validation report...');
      const validationResult = await generateFullValidationReport(index as any);

      const duration = Date.now() - startTime;

      // Log summary
      console.log('\n[Validation] Validation Summary:');
      console.log(`  Status: ${validationResult.success ? 'PASSED' : 'FAILED'}`);
      console.log(`  Total chunks analyzed: ${validationResult.summary.totalChunks}`);
      console.log(`  Average tokens: ${validationResult.summary.avgTokens}`);
      console.log(`  Citation coverage: ${validationResult.summary.coveragePercent}%`);
      console.log(`  Issues found: ${validationResult.summary.issuesCount}`);
      console.log(`  Duration: ${duration}ms`);

      if (validationResult.summary.issuesCount > 0) {
        console.warn('\n[Validation] WARNING: Validation found issues');
        validationResult.qualityReports.forEach((report) => {
          if (report.issues.length > 0) {
            console.warn(`  ${report.jurisdiction}: ${report.issues.length} issues`);
          }
        });
      }

      // Format output
      if (args.format === 'json') {
        outputContent = JSON.stringify(
          {
            ...validationResult,
            durationMs: duration,
          },
          null,
          2
        );
      } else {
        outputContent = formatValidationResultMarkdown(validationResult);
        // Add duration to markdown
        outputContent = outputContent.replace(
          /\*\*Generated:\*\* (.+)/,
          `**Generated:** $1\n**Duration:** ${duration}ms`
        );
      }
    }

    // Output results
    if (args.output) {
      console.log(`\n[Validation] Writing report to: ${args.output}`);
      writeFileSync(args.output, outputContent, 'utf-8');
      console.log('[Validation] Report written successfully');
    } else {
      console.log('\n' + '='.repeat(50));
      console.log(outputContent);
    }

    // Exit with success
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    console.log('\n' + '='.repeat(50));
    console.log(`[Validation] Validation completed successfully in ${totalDuration}ms`);
    process.exit(0);
  } catch (error) {
    console.error('\n[Validation] ERROR: Validation failed');
    console.error('[Validation]', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('[Validation] Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run validation
runValidation().catch((err) => {
  console.error('[Validation] Unexpected error:', err);
  process.exit(1);
});
