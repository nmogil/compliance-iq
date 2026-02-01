---
phase: 02-federal-data
plan: 01
subsystem: data-pipeline
tags: [tiktoken, xml-parser, federal-data, cfr, bluebook]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Pinecone ChunkMetadata type system
provides:
  - CFR type system with TARGET_TITLES constant
  - Token counting utilities for text-embedding-3-large
  - Bluebook citation generators for CFR references
affects: [02-02, 02-03, 02-04]

# Tech tracking
tech-stack:
  added: [js-tiktoken, fast-xml-parser, date-fns, zod]
  patterns: [Bluebook citation format, cl100k_base token counting, CFR hierarchy modeling]

key-files:
  created:
    - apps/workers/src/federal/types.ts
    - apps/workers/src/lib/tokens.ts
    - apps/workers/src/lib/citations.ts
  modified:
    - apps/workers/package.json

key-decisions:
  - "Use cl100k_base encoding (text-embedding-3-large) with 1500 token target"
  - "Bluebook citation format: '[Title] C.F.R. § [Section][(Subsection)]'"
  - "7 target CFR titles (7, 9, 21, 27, 29, 40, 49) with category mappings"

patterns-established:
  - "CFR hierarchy: Title > Chapter > Part > Section > Subsection"
  - "Chunk IDs: cfr-{title}-{part}-{section}-{index}"
  - "Source IDs: cfr-title-{number}"

# Metrics
duration: 3min
completed: 2026-02-01
---

# Phase 2 Plan 01: Federal Data Foundation Summary

**Type-safe CFR data structures, cl100k_base token counting for embeddings, and Bluebook citation generator for legal references**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-01T21:16:25Z
- **Completed:** 2026-02-01T21:19:32Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- CFR type system with 7 target titles mapped to activity categories
- Token counting using cl100k_base encoding for OpenAI text-embedding-3-large
- Bluebook citation generator producing standard legal format
- Hierarchy breadcrumbs and URL generation for eCFR.gov

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and create federal types** - `74f57d8` (feat)
2. **Task 2: Create token counting utility** - `8d05793` (feat)
3. **Task 3: Create Bluebook citation generator** - `746795e` (feat)

## Files Created/Modified

- `apps/workers/src/federal/types.ts` - CFR type definitions (Title, Part, Section, Chunk, PipelineCheckpoint) and TARGET_TITLES constant
- `apps/workers/src/lib/tokens.ts` - Token counting with cl100k_base encoding, chunk validation, and estimation
- `apps/workers/src/lib/citations.ts` - Bluebook citation formatting, eCFR URL generation, hierarchy breadcrumbs
- `apps/workers/package.json` - Added js-tiktoken, fast-xml-parser, date-fns, zod

## Decisions Made

**1. Token target of 1500 for embeddings**
- Rationale: Well under 8192 limit for text-embedding-3-large, allows headroom for metadata and context
- Impact: All chunks will be validated against this target

**2. Bluebook citation format as canonical**
- Format: "21 C.F.R. § 117.3" (with optional subsection)
- Rationale: Standard legal citation format lawyers expect
- Impact: All citations will follow this format for consistency

**3. 7 target CFR titles with category mappings**
- Titles: 7 (Agriculture), 9 (Animals), 21 (Food & Drugs), 27 (Alcohol/Tobacco), 29 (Labor), 40 (Environment), 49 (Transportation)
- Categories: food-safety, pharmacy, alcohol, employment, fuel, hazmat, transportation
- Rationale: Covers all compliance needs for retail operations
- Impact: Pipeline will process only these titles initially

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Ready for Plan 02-02:** eCFR API fetcher can now use these types and utilities.

**Ready for Plan 02-03:** Chunking pipeline can use token counting and citation generation.

**Ready for Plan 02-04:** Embedding pipeline can validate chunk sizes before OpenAI API calls.

**Provides:**
- `CFRTitle`, `CFRPart`, `CFRSection`, `CFRChunk` interfaces
- `TARGET_TITLES` constant with 7 titles and categories
- `countTokens()`, `validateChunkSize()`, `estimateChunkCount()` functions
- `generateCFRCitation()`, `generateECFRUrl()`, `generateHierarchy()` functions
- `parseSection()`, `generateChunkId()`, `generateSourceId()` helpers

**No blockers.** All foundational utilities in place for federal data pipeline.

---
*Phase: 02-federal-data*
*Completed: 2026-02-01*
