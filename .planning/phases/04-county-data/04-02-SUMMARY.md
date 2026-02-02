---
phase: 04-county-data
plan: 02
subsystem: data-pipeline
tags: [county, ordinance, municode, adapter, scraping, cheerio, r2, typescript]

# Dependency graph
requires:
  - phase: 04-01
    provides: County type definitions (CountyOrdinance, CountyAdapter, CountyCheckpoint)
  - phase: 03-state-data
    provides: Scraper utilities (fetchWithRateLimit, retryWithBackoff)
provides:
  - Abstract CountyAdapterBase class with common scraping utilities
  - MunicodeAdapter for 9 Texas counties (Harris, Tarrant, Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso)
  - R2 storage module for county ordinances and checkpoints
  - loadCheerioPage helper for standalone HTML loading
affects: [04-03-PLAN, 04-04-PLAN, county-chunking, county-pipeline, elaws-adapter]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Abstract adapter pattern for heterogeneous county platforms
    - Multiple selector strategies for robust HTML scraping
    - AsyncGenerator for memory-efficient ordinance streaming
    - Checkpoint-based pipeline resumption

key-files:
  created:
    - apps/workers/src/counties/adapters/base.ts
    - apps/workers/src/counties/adapters/municode.ts
    - apps/workers/src/counties/storage.ts
  modified:
    - apps/workers/src/counties/index.ts

key-decisions:
  - "CountyAdapterBase provides loadPage, validateSource, sleep utilities"
  - "MunicodeAdapter uses 1000ms rate limit (conservative for SPA platform)"
  - "Multiple selector strategies for robustness across Municode page variations"
  - "Storage follows texas/storage.ts patterns for consistency"
  - "Checkpoint stored at counties/checkpoints/county.json"

patterns-established:
  - "Adapter pattern: Abstract base with platform-specific implementations"
  - "Selector fallbacks: Try multiple CSS selectors for structure robustness"
  - "R2 key pattern: counties/{fipsCode}/chapter-{chapter}/{section}.html"
  - "Numeric sorting: Sections sorted by numeric value (1, 2, 10 not 1, 10, 2)"

# Metrics
duration: 6min
completed: 2026-02-02
---

# Phase 4 Plan 2: County Adapter Infrastructure Summary

**Abstract CountyAdapterBase with MunicodeAdapter implementation and R2 storage for county ordinances with checkpoint management**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-02T17:44:30Z
- **Completed:** 2026-02-02T17:50:45Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Created abstract CountyAdapterBase class with common utilities (loadPage, validateSource, sleep)
- Implemented MunicodeAdapter for library.municode.com platform (9 target counties)
- Created R2 storage module with 7 functions for ordinances and checkpoints
- Exported new modules from counties/index.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Create base adapter class** - `599d88a` (feat)
2. **Task 2: Create MunicodeAdapter** - `41a3b82` (feat)
3. **Task 3: Create county storage module** - `8becee5` (feat)
4. **Index exports update** - `bfc8f80` (feat)

## Files Created/Modified

- `apps/workers/src/counties/adapters/base.ts` - Abstract CountyAdapterBase with loadPage, validateSource, sleep utilities; standalone loadCheerioPage helper
- `apps/workers/src/counties/adapters/municode.ts` - MunicodeAdapter for library.municode.com with TOC extraction, chapter navigation, section parsing
- `apps/workers/src/counties/storage.ts` - R2 storage functions: storeCountyOrdinance, getCountyOrdinance, listCountyOrdinances, saveCountyCheckpoint, loadCountyCheckpoint, clearCountyCheckpoint, getCountyStorageStats
- `apps/workers/src/counties/index.ts` - Added exports for adapters and storage modules

## Decisions Made

1. **Conservative rate limiting** - MunicodeAdapter uses 1000ms delay (double the base 500ms) due to Municode's SPA architecture potentially being more sensitive to scraping
2. **Multiple selector strategies** - Both adapter and storage use multiple CSS selectors to handle HTML structure variations across different county pages
3. **Fallback content extraction** - When structured sections not found, MunicodeAdapter extracts full page content as fallback
4. **Numeric sorting** - Section listings sorted by numeric value to ensure correct ordering (1, 2, 10 instead of 1, 10, 2)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **Pre-existing TypeScript errors**: texas/fetch-statutes.ts and texas/parse-statutes.ts have type errors from Phase 3 (documented in STATE.md). County files compile independently without errors.
- **Linter modifications**: ESLint/Prettier auto-formatted base.ts file during development, resulting in cleaner final output.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Adapter pattern established for implementing additional platform adapters (eLaws for Dallas County)
- Storage module ready for pipeline integration
- MunicodeAdapter ready for testing with live Harris County data
- **Note**: Municode is an SPA - full scraping may require API discovery or Playwright in the future
- **Note**: Dallas County eLaws adapter (04-03-PLAN) needed to complete platform coverage

---
*Phase: 04-county-data*
*Completed: 2026-02-02*
