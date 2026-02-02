---
phase: 05
plan: 01
subsystem: municipal-data
tags: [types, registry, citations, firecrawl, municode, amlegal]
dependency-graph:
  requires: [04-county-data]
  provides: [municipal-types, city-registry, municipal-citations]
  affects: [05-02-scraper, 05-03-storage, 05-04-chunking, 05-05-pipeline]
tech-stack:
  added: []
  patterns: [firecrawl-config, city-registry, bluebook-citations]
key-files:
  created:
    - apps/workers/src/municipal/types.ts
    - apps/workers/src/municipal/cities.ts
    - apps/workers/src/municipal/index.ts
    - apps/workers/src/municipal/storage.ts
  modified:
    - apps/workers/src/lib/citations.ts
decisions:
  - id: municipal-platform-config
    choice: Firecrawl with platform-specific waitFor
    rationale: Municode SPA needs 2000ms, American Legal server-rendered needs 1000ms
  - id: city-registry-structure
    choice: Array with helper functions
    rationale: Consistent with county sources.ts pattern
  - id: citation-format
    choice: Bluebook Rule 12.9.2 for municipal codes
    rationale: Standard legal format lawyers expect
metrics:
  duration: 4m
  completed: 2026-02-02
---

# Phase 05 Plan 01: Municipal Types and City Registry Summary

**One-liner:** Type definitions for 20 Texas cities with Firecrawl configuration and Bluebook citation generators.

## Outcome

Successfully established foundation for municipal data pipeline:
- 5 TypeScript interfaces for municipal data structures
- 20 Texas cities registered (17 Municode, 3 American Legal)
- 5 citation utility functions for municipal ordinances
- Platform-specific Firecrawl configuration

## Completed Tasks

| Task | Description | Commit | Key Files |
|------|-------------|--------|-----------|
| 1 | Create municipal type definitions | e4fb2b9 | municipal/types.ts |
| 2 | Create 20-city Texas registry | d0c26bf | municipal/cities.ts, municipal/storage.ts |
| 3 | Add municipal citation generators | d6dd585 | lib/citations.ts, municipal/index.ts |

## Key Implementation Details

### Type Definitions (types.ts - 129 lines)
- `MunicipalCityConfig`: Platform, baseUrl, Firecrawl settings
- `MunicipalOrdinance`: Parsed ordinance with subsections
- `MunicipalChunk`: Embedding-ready chunk with citation
- `MunicipalCheckpoint`: Pipeline resumption state
- `MunicipalBatchResult`: Batch processing results with credit tracking

### City Registry (cities.ts)
**17 Municode cities:**
Houston, San Antonio, Austin, El Paso, Arlington, Plano, Corpus Christi, Lubbock, Laredo, Irving, Garland, Frisco, McKinney, Amarillo, Grand Prairie, Brownsville, Pasadena

**3 American Legal cities:**
Dallas, Fort Worth, Killeen

**Helper functions:**
- `getEnabledCities()` - Returns all 20 enabled cities
- `getSkippedCities()` - Returns disabled cities
- `getCityById(id)` - Lookup by URL-safe ID
- `getCityByName(name)` - Case-insensitive name lookup
- `getMunicodeCities()` - Filter Municode cities
- `getAmlegalCities()` - Filter American Legal cities
- `getCoverageStats()` - Platform distribution statistics

### Citation Functions (lib/citations.ts)
- `generateMunicipalCitation(city, section, year?)`: "Houston, Tex., Code of Ordinances sect. 1-2 (2026)"
- `generateMunicipalChunkId(cityId, chapter, section, index)`: "municipal-houston-1-1-2-0"
- `generateMunicipalSourceId(cityId)`: "municipal-houston"
- `generateMunicipalUrl(config, section?)`: Platform-aware URL generation
- `generateMunicipalHierarchy(city, chapter, section)`: Breadcrumb array

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Platform wait times | 2000ms Municode, 1000ms American Legal | Municode SPA needs more rendering time |
| City ID format | URL-safe lowercase (houston, san_antonio) | Consistent with R2 storage keys |
| Citation format | Bluebook Rule 12.9.2 | Standard legal citation for municipal codes |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed auto-generated storage.ts TypeScript errors**
- **Found during:** Task 2
- **Issue:** Pre-commit hook created storage.ts with TypeScript errors (undefined types, index signature access)
- **Fix:** Fixed optional chaining and index signature access patterns
- **Files modified:** apps/workers/src/municipal/storage.ts
- **Commit:** d0c26bf (included with cities.ts)

## Verification Results

1. TypeScript compiles without errors (municipal module)
2. All 20 cities registered in TEXAS_CITIES array
3. Platform distribution: 17 Municode, 3 American Legal
4. All helper functions exported from municipal/index.ts
5. Citation functions produce expected Bluebook format:
   - Citation: "Houston, Tex., Code of Ordinances sect. 1-2 (2026)"
   - Chunk ID: "municipal-houston-1-1-2-0"
   - Source ID: "municipal-houston"

## Next Phase Readiness

**Ready for 05-02-PLAN.md:** Firecrawl scraper implementation
- Types available for MunicipalOrdinance, MunicipalChunk
- City configs ready with Firecrawl settings
- Storage module ready for markdown cache

**Dependencies fulfilled:**
- MunicipalCityConfig interface exported
- TEXAS_CITIES registry exported
- Citation functions exported

## Files Created/Modified

**Created:**
- `apps/workers/src/municipal/types.ts` - 129 lines, 5 interfaces
- `apps/workers/src/municipal/cities.ts` - 311 lines, 20 cities, 7 helpers
- `apps/workers/src/municipal/index.ts` - 13 lines, module exports
- `apps/workers/src/municipal/storage.ts` - 418 lines (auto-generated, fixed)

**Modified:**
- `apps/workers/src/lib/citations.ts` - Added 5 municipal citation functions
