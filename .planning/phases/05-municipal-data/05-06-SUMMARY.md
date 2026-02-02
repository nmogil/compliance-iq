---
phase: 05-municipal-data
plan: 06
subsystem: municipal-pipeline
tags: [http-endpoints, convex, coverage-reporting, pinecone-filtering]
depends_on:
  requires: [05-05]
  provides: [http-triggering, convex-tracking, coverage-reports, query-validation]
  affects: []
tech-stack:
  added: []
  patterns: [http-endpoints, convex-queries, coverage-reporting]
key-files:
  created:
    - apps/workers/src/municipal/coverage.ts
    - scripts/test-municipal-query.ts
  modified:
    - apps/workers/src/index.ts
    - apps/workers/src/types.ts
    - apps/convex/convex/schema.ts
    - apps/convex/convex/jurisdictions.ts
    - apps/workers/src/municipal/index.ts
decisions:
  - key: municipal-http-endpoints
    choice: 4 endpoints matching county pattern
    rationale: Consistent API design across pipeline types
  - key: cityId-index
    choice: Add by_city_id index to jurisdictions schema
    rationale: Efficient city lookup for status tracking
  - key: coverage-report-format
    choice: JSON + Markdown output
    rationale: JSON for programmatic use, Markdown for documentation
metrics:
  duration: ~15 minutes
  completed: 2026-02-02
---

# Phase 05 Plan 06: HTTP Endpoints and Coverage Summary

HTTP endpoints for municipal pipeline triggering and Convex coverage tracking for 20 Texas cities.

## One-liner

4 HTTP endpoints for municipal pipeline, 4 Convex functions for city tracking, coverage report generator with JSON/Markdown output.

## What Was Built

### Task 1: HTTP Endpoints (apps/workers/src/index.ts)

Added 4 HTTP endpoints for municipal pipeline management:

| Method | Path | Description |
|--------|------|-------------|
| POST | /pipeline/municipal | Process all 20 enabled Texas cities |
| POST | /pipeline/municipal/:city | Process single city by ID/name |
| GET | /pipeline/municipal/status | Get pipeline status and storage stats |
| POST | /pipeline/municipal/reset | Clear checkpoint for fresh run |

Also updated `apps/workers/src/types.ts`:
- Added `FIRECRAWL_API_KEY: string` to Env interface
- Added `R2_BUCKET: R2Bucket` alias for municipal module compatibility

### Task 2: Convex Schema and Functions

**Schema Update (apps/convex/convex/schema.ts):**
- Added `cityId` field (optional string) to jurisdictions table
- Added `by_city_id` index for efficient city lookup

**Convex Functions (apps/convex/convex/jurisdictions.ts):**
- `listTexasCities` - List all 20 target cities with coverage status
- `updateCityStatus` - Update city status after pipeline processing
- `getCityByCityId` - Get city by cityId with efficient index lookup
- `getTexasCityCoverage` - Aggregate coverage statistics by platform

### Task 3: Coverage Report Generator

**Coverage Module (apps/workers/src/municipal/coverage.ts):**
- `generateMunicipalCoverageReport()` - JSON report with statistics
- `formatCoverageReportMarkdown()` - Human-readable markdown format
- Tracks all 20 cities: processed, failed, pending states
- Platform distribution (17 Municode, 3 American Legal)
- Firecrawl credit usage tracking

**Test Script (scripts/test-municipal-query.ts):**
- Validates TX-{cityId} jurisdiction filtering
- Tests sourceType: 'municipal' filter
- Validates metadata fields (chunkId, citation, cityId, etc.)
- Tests Houston, Dallas, Austin query filtering

## Commits

| Hash | Message |
|------|---------|
| 95f8007 | feat(05-06): add HTTP endpoints for municipal pipeline |
| 0d752bf | feat(05-06): add Convex functions for municipal jurisdiction tracking |
| 342f91c | feat(05-06): create coverage report generator and query test script |

## Files Changed

### Created
- `apps/workers/src/municipal/coverage.ts` - Coverage report generator
- `scripts/test-municipal-query.ts` - Pinecone query validation script

### Modified
- `apps/workers/src/index.ts` - Added 4 HTTP endpoints
- `apps/workers/src/types.ts` - Added FIRECRAWL_API_KEY and R2_BUCKET
- `apps/convex/convex/schema.ts` - Added cityId field and index
- `apps/convex/convex/jurisdictions.ts` - Added 4 city tracking functions
- `apps/workers/src/municipal/index.ts` - Exported coverage module

## Verification

- [x] 4 HTTP endpoints added for municipal pipeline
- [x] 4 Convex functions for municipal jurisdiction tracking
- [x] Coverage report shows all 20 target cities
- [x] Test script validates TX-{cityId} jurisdiction filtering in Pinecone
- [x] All exports available from municipal/index.ts
- [x] TypeScript compiles without new errors

## Deviations from Plan

None - plan executed exactly as written.

## Phase 5 Complete

With plan 05-06 complete, Phase 5 (Municipal Data) is finished.

### Phase 5 Deliverables Summary

| Plan | Description | Status |
|------|-------------|--------|
| 05-01 | Type System and City Registry | Complete |
| 05-02 | Firecrawl Scraper and Parser | Complete |
| 05-03 | Storage Module | Complete |
| 05-04 | Chunking Module | Complete |
| 05-05 | Pipeline Orchestration | Complete |
| 05-06 | HTTP Endpoints and Coverage | Complete |

### Key Capabilities Delivered

1. **20 Texas cities configured** - Houston, San Antonio, Dallas, Austin, Fort Worth, etc.
2. **Firecrawl scraping** - JavaScript-rendered Municode and American Legal sites
3. **R2 storage** - Ordinances + 30-day markdown cache to minimize Firecrawl costs
4. **Municipal chunking** - 1500 token limit, 15% overlap, Bluebook citations
5. **Pinecone indexing** - TX-{cityId} jurisdiction, sourceType: 'municipal'
6. **HTTP endpoints** - Manual pipeline triggering
7. **Convex tracking** - Coverage status for all 20 cities
8. **Coverage reporting** - JSON and Markdown formats

### Next Phase Readiness

**Before production:**
- Configure FIRECRAWL_API_KEY in Cloudflare Workers secrets
- Ensure R2_BUCKET binding matches DOCUMENTS_BUCKET
- Run municipal pipeline: `POST /pipeline/municipal`
- Validate with: `pnpm exec tsx scripts/test-municipal-query.ts`
