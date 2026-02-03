---
phase: 07-query-pipeline
plan: 04
subsystem: query
tags: [typescript, claude, anthropic, parsing, citations, convex]

# Dependency graph
requires:
  - phase: 07-query-pipeline
    plan: 01
    provides: Query pipeline type definitions (RetrievedChunk, Citation, Permit, JurisdictionSection)
  - phase: 06-data-processing
    provides: ChunkMetadata schema for citation validation
affects: [07-05, 07-06, 08-answer-generation]

# Tech tracking
tech-stack:
  added: ["@anthropic-ai/sdk"]
  patterns: [citation-validation, permit-parsing, jurisdiction-section-parsing]

key-files:
  created:
    - apps/convex/convex/lib/generate.ts
    - apps/convex/convex/lib/parse.ts
  modified:
    - apps/convex/package.json

key-decisions:
  - "Non-streaming generation first (streaming deferred to Phase 9/QUERY-05)"
  - "Temperature 0 for factual accuracy in compliance context"
  - "Citation validation warns but doesn't fail on invalid references"
  - "Permits extracted via regex pattern matching from structured section"
  - "Jurisdiction sections parsed by header-based splitting (### Federal, ### State, etc.)"

patterns-established:
  - "GenerationError with typed error codes (API_ERROR, RATE_LIMIT, CONTENT_FILTER, TIMEOUT)"
  - "Citation references are 1-based [1], [2], [3] mapping to 0-based chunk array"
  - "parseAnswer returns warnings array for invalid citations without throwing"

# Metrics
duration: 2.5min
completed: 2026-02-03
---

# Phase 7 Plan 4: Claude Answer Generation & Response Parsing Summary

**Claude API integration for cited compliance answers with structured citation/permit extraction**

## Performance

- **Duration:** 2.5 min
- **Started:** 2026-02-03T21:00:49Z
- **Completed:** 2026-02-03T21:03:19Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- Claude API integration using Anthropic SDK for non-streaming answer generation
- Response parser extracts citations, validates references, and identifies permits
- Jurisdiction section parser splits answers by Federal/State/County/Municipal headers
- Citation validation warns about invalid [N] references without breaking pipeline

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Claude answer generation module** - `20a6fcf` (feat)
2. **Task 2: Create response parsing module** - `4eb54cd` (feat)

## Files Created/Modified
- `apps/convex/convex/lib/generate.ts` - Claude API integration with generateAnswer function and GenerationError class
- `apps/convex/convex/lib/parse.ts` - Response parsing with extractCitations, validateCitations, extractPermits, parseJurisdictionSections, parseAnswer
- `apps/convex/package.json` - Added @anthropic-ai/sdk ^0.72.1

## Decisions Made

**1. Non-streaming generation first**
- Plan specifies streaming deferred to Phase 9 (QUERY-05)
- Alternative: Implement streaming immediately
- Decision: Start with non-streaming for correct answers with citations
- Rationale: Streaming adds complexity; focus on correctness first, UX optimization later

**2. Temperature 0 for compliance context**
- Use temperature 0 instead of higher values
- Alternative: Use temperature 0.3-0.7 for more natural language
- Decision: Temperature 0 for maximum factual accuracy
- Rationale: Legal compliance requires precise, deterministic answers; creativity is not desired

**3. Citation validation warns but doesn't fail**
- validateCitations returns warnings for invalid [N] references
- Alternative: Throw exception on invalid citations
- Decision: Collect warnings, don't break pipeline
- Rationale: Claude might occasionally generate invalid refs; better to surface in warnings than crash the query

**4. Permit extraction via regex pattern matching**
- Parse permits using regex for structured fields (Permit Name, Issuing Agency, etc.)
- Alternative: Use LLM to extract permits in structured format
- Decision: Regex-based extraction from expected format
- Rationale: Claude will generate permits in specified format (from prompt engineering); regex is faster and more reliable than additional LLM call

**5. Jurisdiction section parsing by header splitting**
- Parse sections by matching ### Federal, ### State, ### County, ### Municipal headers
- Alternative: Use LLM to identify jurisdiction boundaries
- Decision: Header-based regex splitting
- Rationale: Clear delimiter pattern in prompt specification; deterministic parsing is preferred

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added TypeScript strict null checks**
- **Found during:** Task 1 and Task 2
- **Issue:** TypeScript strict mode flagged potential undefined access in regex match groups and array indexing
- **Fix:** Added null checks for match[1], match[2], etc., and chunk array access
- **Files modified:** `apps/convex/convex/lib/generate.ts`, `apps/convex/convex/lib/parse.ts`
- **Commit:** Included in task commits
- **Rationale:** TypeScript strict mode is enabled in project; null checks are critical for type safety

**2. [Rule 1 - Bug] Fixed GenerationError override modifier**
- **Found during:** Task 1 compilation
- **Issue:** TypeScript flagged missing `override` modifier on `cause` property that shadows Error.cause
- **Fix:** Moved properties to class body with explicit `override readonly cause` and manual assignment in constructor
- **Files modified:** `apps/convex/convex/lib/generate.ts`
- **Commit:** Included in Task 1 commit
- **Rationale:** TypeScript configuration requires override modifiers; prevents accidental shadowing

## Issues Encountered

**Pre-existing TypeScript errors in other files**
- During compilation verification, found TypeScript errors in `convex/jurisdictions.ts`, `convex/sources.ts`, `convex/lib/geocode.ts`
- These are pre-existing errors not introduced by this plan
- Verified that `generate.ts` and `parse.ts` compile without errors by checking error output
- No action taken as these are outside plan scope

## User Setup Required

None - Anthropic API key will be configured in environment when query actions are implemented in later plans.

## Next Phase Readiness

**Ready for next phase:**
- Claude answer generation ready for integration in query pipeline action
- Response parser handles full answer structure (citations, permits, jurisdiction sections)
- Error handling covers rate limits, content filters, and API errors

**Dependencies for next plans:**
- Plan 07-05: Confidence scoring (uses retrieval metrics to assess answer quality)
- Plan 07-06: Query pipeline orchestration (combines geocoding, embedding, retrieval, generation, parsing)

**Known considerations:**
- Anthropic SDK client initialization should be cached/reused across requests (Convex action best practice)
- Prompt engineering for jurisdiction sections and permit format will be defined in Plan 07-06
- Citation numbering assumes sequential chunk ordering from retrieval (validated by parseAnswer)

**No blockers or concerns.**

---
*Phase: 07-query-pipeline*
*Completed: 2026-02-03*
