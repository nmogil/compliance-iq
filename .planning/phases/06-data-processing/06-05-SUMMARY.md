---
phase: 06
plan: 05
subsystem: data-processing-validation
tags: [quality-reporting, validation, pinecone, r2, convex-sync, markdown-formatting]
requires:
  - 06-01-types
  - 06-02-token-analyzer
  - 06-03-metadata-validator
provides:
  - quality-reporter
  - r2-validation
  - convex-sync-validation
  - validation-report-formatting
affects:
  - 06-06-http-endpoints
tech-stack:
  added:
    - none
  patterns:
    - sampling-based-validation
    - comprehensive-quality-reporting
    - cross-source-aggregation
key-files:
  created:
    - apps/workers/src/validation/quality-reporter.ts
  modified:
    - apps/workers/src/validation/index.ts
decisions:
  - title: "Pinecone sampling approach"
    rationale: "Pinecone doesn't support bulk export - use query with dummy vector to sample up to 1000 chunks per source type"
    impact: "Reports are based on representative samples, not exhaustive analysis"
  - title: "ConvexQueryFn interface abstraction"
    rationale: "Workers package doesn't have Convex dependency - use generic query function interface"
    impact: "Validation function can be called from any context with appropriate query adapter"
  - title: "R2 folder structure validation"
    rationale: "Validate expected top-level folders exist and indexed jurisdictions have corresponding data"
    impact: "Catches infrastructure issues and incomplete pipeline runs"
metrics:
  duration: "3 minutes"
  completed: "2026-02-02"
---

# Phase 6 Plan 5: Quality Reporter Summary

**One-liner:** Comprehensive data quality reporter with token analysis, metadata validation, R2 storage checks, and Convex sync validation

## What Was Built

Created the quality reporter module that aggregates token analysis and metadata validation into actionable quality reports by jurisdiction.

### Key Components

1. **fetchChunksForJurisdiction**
   - Samples chunks from Pinecone using dummy zero vector with metadata filters
   - Supports filtering by sourceType and optional jurisdiction
   - Default limit of 1000 chunks (Pinecone doesn't support bulk export)
   - Documented sampling approach in JSDoc

2. **generateQualityReport**
   - Aggregates token distribution, metadata completeness, citation coverage
   - Calls analyzeTokenDistribution on chunk texts
   - Calls getMetadataCompleteness for optional field tracking
   - Calls checkCitationCoverage for citation presence
   - Calls validateMetadataArray to find specific issues
   - Returns DataQualityReport with all metrics and issue list

3. **generateFullValidationReport**
   - Fetches samples for federal, state, county, municipal source types
   - Generates quality report for each source type with data
   - Aggregates into ValidationResult with cross-source summary
   - Calculates overall statistics: totalChunks, avgTokens, coveragePercent, issuesCount
   - Includes CoverageReport showing expected vs indexed by source type

4. **formatQualityReportMarkdown**
   - Formats single jurisdiction report as human-readable markdown
   - Sections: Summary, Token Distribution, Metadata Completeness, Issues
   - Tables for distribution stats and metadata field percentages
   - Lists specific validation issues with chunk IDs

5. **formatValidationResultMarkdown**
   - Formats full validation result as comprehensive markdown report
   - Executive summary with overall statistics
   - Source type coverage table showing expected vs indexed
   - Individual quality reports for each source type
   - Critical issues section highlighting problematic chunks

6. **validateR2Storage**
   - Validates R2 folder structure for federal/, texas/, counties/, municipal/
   - Checks each indexed jurisdiction has corresponding data in R2
   - Determines prefix based on jurisdiction format (US, TX, TX-48XXX, TX-cityId)
   - Returns R2ValidationResult with missingFolders and jurisdictionsWithoutData

7. **validateConvexSync**
   - Validates Convex jurisdiction tracking matches Pinecone indexing
   - Uses ConvexQueryFn interface to avoid direct Convex dependency
   - Checks for: missing jurisdictions, stale timestamps, vector count mismatches
   - 10% tolerance for vector count differences
   - Returns ConvexValidationResult with sync issues

### Type System

All quality reporting types defined in validation/types.ts:
- DataQualityReport
- ValidationResult
- R2ValidationResult (added)
- ConvexValidationResult (added)
- CoverageReport, JurisdictionCoverage

### Module Exports

Updated validation/index.ts to export quality-reporter alongside existing modules.

## Technical Decisions

### 1. Sampling-Based Validation
**Decision:** Use Pinecone query with dummy zero vector to sample chunks
**Rationale:** Pinecone doesn't provide bulk export API - query is the only way to fetch chunks
**Impact:** Reports based on up to 1000 chunks per source type, not exhaustive
**Alternative considered:** Direct Pinecone index scan - not supported by Pinecone API

### 2. ConvexQueryFn Abstraction
**Decision:** Use generic query function interface instead of direct ConvexHttpClient dependency
**Rationale:** Workers package doesn't have Convex dependency, would require adding it just for types
**Impact:** Caller provides query adapter: `(fn, args) => convexClient.query(fn, args)`
**Alternative considered:** Add convex package to workers - rejected due to unnecessary dependency

### 3. R2 Folder Structure Validation
**Decision:** Validate top-level folders and jurisdiction-specific prefixes
**Rationale:** Catches missing infrastructure setup and incomplete pipeline runs
**Impact:** Early detection of R2 storage issues before indexing failures
**Pattern:** federal/, texas/, counties/{fips}/, municipal/{cityId}/

### 4. Markdown Formatting
**Decision:** Provide both JSON and Markdown report formats
**Rationale:** JSON for programmatic consumption, Markdown for human review
**Impact:** Reports can be logged, saved to files, or displayed in UI
**Sections:** Executive summary, source type coverage, individual reports, critical issues

## Validation Results

All verification steps passed:

1. ✅ TypeScript compilation passes for quality-reporter.ts
2. ✅ TypeScript compilation passes for validation/index.ts
3. ✅ All analyzer/validator imports resolve correctly
4. ✅ Quality reports conform to DataQualityReport type
5. ✅ Markdown formatting produces readable structured output
6. ✅ R2 validation checks folder structure for all source types
7. ✅ Convex sync validates lastScrapedAt, status, vectorCount
8. ✅ Sample-based approach documented in JSDoc

## Files Modified

**Created:**
- `apps/workers/src/validation/quality-reporter.ts` (608 lines)
  - 7 exported functions
  - ConvexQueryFn interface
  - Comprehensive JSDoc documentation

**Modified:**
- `apps/workers/src/validation/index.ts`
  - Added quality-reporter export

## Deviations from Plan

None - plan executed exactly as written.

## Requirements Delivered

This plan validates:
- **DATA-07:** Chunking pipeline quality metrics (token distribution analysis)
- **DATA-08:** Metadata completeness tracking (optional field coverage)
- **DATA-09:** Citation coverage measurement (percentage of chunks with citations)

## Integration Points

### Upstream Dependencies (Imports)
- `validation/token-analyzer`: analyzeTokenDistribution
- `validation/metadata-validator`: getMetadataCompleteness, checkCitationCoverage, validateMetadataArray
- `validation/types`: All validation result types
- `pinecone`: ChunkMetadata, queryChunks, Index

### Downstream Consumers (Exports)
- HTTP endpoints (06-06) will call generateFullValidationReport
- CLI scripts can use formatValidationResultMarkdown for reports
- Quality monitoring can track DataQualityReport metrics over time

## Testing Notes

For future testing:

1. **Integration test with live Pinecone:**
   ```ts
   const index = getIndex(initPinecone(process.env.PINECONE_API_KEY));
   const result = await generateFullValidationReport(index);
   console.log(formatValidationResultMarkdown(result));
   ```

2. **R2 validation test:**
   ```ts
   const r2Result = await validateR2Storage(env.DOCUMENTS_BUCKET, ['US', 'TX']);
   assert(r2Result.valid, 'R2 storage should be valid');
   ```

3. **Convex sync validation test:**
   ```ts
   const convexQuery = (fn, args) => convexClient.query(fn, args);
   const counts = new Map([['TX', 1500]]);
   const syncResult = await validateConvexSync(convexQuery, ['TX'], counts);
   assert(syncResult.valid, 'Convex sync should be valid');
   ```

## Next Steps

Plan 06-06 will:
- Create HTTP endpoints to trigger validation reports
- Expose quality metrics via REST API
- Enable on-demand validation runs
- Support filtered validation by source type or jurisdiction

## Performance Considerations

- Sampling 1000 chunks per source type (4 source types = 4000 chunks max)
- Token counting uses cl100k_base encoding (fast, no API calls)
- Metadata validation is O(n) over sampled chunks
- R2 list operations limited to 1 object per prefix (fast check)
- Convex queries batched per jurisdiction (minimize round trips)

Estimated validation time: ~5-10 seconds for full report across all source types.
