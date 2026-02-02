---
phase: 05-municipal-data
plan: 03
subsystem: storage
tags: [r2, cloudflare, municipal, ordinances, checkpoint, markdown-cache]

# Dependency graph
requires:
  - phase: 05-01
    provides: MunicipalOrdinance, MunicipalCheckpoint, MunicipalCityConfig types
provides:
  - R2 storage functions for municipal ordinances
  - Markdown caching for Firecrawl cost optimization
  - Pipeline checkpoint management for fault tolerance
affects: [05-04, 05-05, 05-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "R2 storage with customMetadata for audit trails"
    - "maxAgeMs cache expiration for markdown"
    - "City-based folder hierarchy"

key-files:
  created:
    - apps/workers/src/municipal/storage.ts
  modified:
    - apps/workers/src/municipal/index.ts

key-decisions:
  - "Single checkpoint for all municipal processing (vs per-city)"
  - "Markdown cache with maxAgeMs expiration parameter"
  - "R2 folder structure: municipal/{cityId}/chapter-{chapter}/{section}.json"

patterns-established:
  - "Municipal R2 key pattern: municipal/{cityId}/chapter-{chapter}/{section}.json"
  - "Markdown cache pattern: municipal/{cityId}/raw/page.md"
  - "Checkpoint pattern: municipal/checkpoints/municipal.json"

# Metrics
duration: 2min
completed: 2026-02-02
---

# Phase 05 Plan 03: Municipal Storage Summary

**R2 storage module with 10 functions for ordinances, markdown cache, checkpoints, and storage statistics**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-02T20:48:48Z
- **Completed:** 2026-02-02T20:50:43Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- 10 storage functions following county/storage.ts patterns
- Markdown caching with maxAgeMs expiration for Firecrawl cost optimization
- Pipeline checkpoint management for fault-tolerant processing
- Storage statistics for monitoring

## Task Commits

Each task was committed atomically:

1. **Task 1: Create municipal storage module** - `d0c26bf` (feat)
2. **Task 2: Update module exports** - `d6dd585` (feat)

_Note: Tasks were completed as part of 05-01 execution since storage.ts was needed for the types/cities plan._

## Files Created/Modified

- `apps/workers/src/municipal/storage.ts` - R2 storage operations (416 lines)
  - storeMunicipalOrdinance, getMunicipalOrdinance, listMunicipalOrdinances, storeMunicipalOrdinances
  - storeMunicipalMarkdown, getMunicipalMarkdown (with maxAgeMs expiration)
  - saveMunicipalCheckpoint, loadMunicipalCheckpoint, clearMunicipalCheckpoint
  - getMunicipalStorageStats
- `apps/workers/src/municipal/index.ts` - Module exports including storage

## Decisions Made

- **Single checkpoint:** All municipal processing uses one checkpoint file (vs county pattern of per-source)
- **maxAgeMs expiration:** Markdown cache supports age-based invalidation to control Firecrawl credit usage
- **City-based hierarchy:** R2 folder structure uses cityId (e.g., "houston") rather than FIPS codes

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created types.ts with required interfaces**
- **Found during:** Task 1 (Create storage module)
- **Issue:** storage.ts imports MunicipalOrdinance, MunicipalCheckpoint from ./types but types.ts didn't exist
- **Fix:** types.ts was created as part of 05-01 execution (dependency overlap between plans)
- **Files modified:** apps/workers/src/municipal/types.ts
- **Verification:** TypeScript compiles without errors for storage.ts
- **Committed in:** e4fb2b9 (05-01 Task 1)

---

**Total deviations:** 1 auto-fixed (1 blocking - prerequisite types)
**Impact on plan:** Blocking dependency on 05-01's types was resolved by prior execution. Storage module compiles and works correctly.

## Issues Encountered

- Pre-existing TypeScript errors in texas/fetch-statutes.ts and texas/parse-statutes.ts (not related to this plan, documented in STATE.md)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Storage module ready for scraper/parser (05-02) integration
- Markdown cache ready for Firecrawl cost optimization
- Checkpoint system ready for pipeline orchestration (05-04, 05-05)
- All exports available from municipal/index.ts

---
*Phase: 05-municipal-data*
*Completed: 2026-02-02*
