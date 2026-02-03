---
phase: 07-query-pipeline
plan: 01
subsystem: query
tags: [typescript, geocoding, convex, geocodio, rag, types]

# Dependency graph
requires:
  - phase: 06-data-processing
    provides: ChunkMetadata schema and Pinecone index with jurisdictions
provides:
  - Query pipeline type definitions (9 interfaces)
  - Geocodio-based geocoding service with jurisdiction resolution
  - Federal/state/county/municipal jurisdiction extraction
affects: [07-02, 07-03, 07-04, 07-05, 07-06, 08-answer-generation]

# Tech tracking
tech-stack:
  added: []
  patterns: [jurisdiction-array-filtering, graceful-geocoding-fallback]

key-files:
  created:
    - apps/convex/convex/query/types.ts
    - apps/convex/convex/lib/geocode.ts
  modified: []

key-decisions:
  - "Use flat RetrievedChunk interface (not nested metadata) for simpler access patterns"
  - "Always return federal-only fallback on geocoding errors - never break pipeline"
  - "Normalize city names to lowercase with hyphens for consistent jurisdiction IDs"

patterns-established:
  - "Jurisdiction array format: ['US', 'TX', 'TX-48201', 'TX-houston']"
  - "Geocoding errors gracefully fallback to federal-only without throwing"
  - "JurisdictionResult includes raw API response for debugging"

# Metrics
duration: 3min
completed: 2026-02-03
---

# Phase 7 Plan 1: Query Pipeline Foundation Summary

**Complete type system for RAG pipeline with Geocodio-based address-to-jurisdiction resolution**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-03T20:53:04Z
- **Completed:** 2026-02-03T20:56:10Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Query pipeline type definitions: 9 interfaces covering full RAG flow
- Geocoding service extracts federal, state, county, municipal jurisdictions from addresses
- Graceful fallback ensures pipeline continues even with geocoding failures

## Task Commits

Each task was committed atomically:

1. **Task 1: Create query pipeline types** - `7ecd0db` (feat)
2. **Task 2: Implement geocoding service** - `69e617d` (feat)

## Files Created/Modified
- `apps/convex/convex/query/types.ts` - 9 TypeScript interfaces for query pipeline (QueryRequest, QueryResult, JurisdictionResult, RetrievedChunk, Citation, Permit, ConfidenceScore, JurisdictionSection, GeneratedAnswer)
- `apps/convex/convex/lib/geocode.ts` - Geocodio API integration with geocodeAddress, normalizeCity, getFallbackJurisdictions

## Decisions Made

**1. Flat RetrievedChunk interface structure**
- Plan specified nested fields (text, citation, jurisdiction as top-level properties)
- Alternative: Match Pinecone's nested metadata structure
- Decision: Flat structure for simpler access patterns in answer generation
- Rationale: Avoids `chunk.metadata.text` everywhere, makes iteration cleaner

**2. Federal-only fallback on geocoding errors**
- Never throw exceptions from geocodeAddress
- Return `{ jurisdictions: ['US'], ... }` on any error
- Rationale: Invalid address shouldn't break entire query pipeline; federal regulations apply everywhere

**3. City normalization pattern**
- Convert "Fort Worth" → "fort-worth" for jurisdiction IDs
- Lowercase + replace spaces with hyphens + strip special characters
- Rationale: Consistent with municipal pipeline city IDs (e.g., TX-houston, TX-fort-worth)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required in this plan. Geocodio API key will be configured in later plan when query actions are implemented.

## Next Phase Readiness

**Ready for next phase:**
- Type system complete for entire query pipeline
- Geocoding service ready for integration in query actions
- Jurisdiction format matches Pinecone metadata structure

**Dependencies for next plans:**
- Plan 07-02: Query embedding generation (convert question to vector)
- Plan 07-03: Pinecone retrieval with jurisdiction filtering
- Plan 07-04: Claude answer generation with citations

**No blockers or concerns.**

---
*Phase: 07-query-pipeline*
*Completed: 2026-02-03*
