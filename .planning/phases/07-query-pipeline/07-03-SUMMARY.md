---
phase: 07-query-pipeline
plan: 03
subsystem: query
tags: [typescript, rag, prompts, claude, confidence-scoring, retrieval-metrics]

# Dependency graph
requires:
  - phase: 07-query-pipeline
    plan: 01
    provides: Query pipeline type definitions (RetrievedChunk, ConfidenceScore interfaces)
provides:
  - Retrieval-based confidence scoring (not LLM self-assessment)
  - Claude system prompt with jurisdiction sections and citation rules
  - User prompt templates with numbered chunks for citation tracking
  - Citation list formatter for UI/CLI display
affects: [07-04, 07-05, 07-06, 08-answer-generation]

# Tech tracking
tech-stack:
  added: []
  patterns: [retrieval-based-confidence, jurisdiction-layered-prompts, numbered-citations]

key-files:
  created:
    - apps/convex/convex/lib/confidence.ts
    - apps/convex/convex/lib/prompt.ts
  modified: []

key-decisions:
  - "Weighted confidence scoring: 50% similarity, 30% jurisdiction coverage, 20% citation coverage"
  - "High confidence requires score > 0.8 AND full jurisdiction coverage (prevents false confidence)"
  - "Prompt organizes response by jurisdiction level (Federal, State, County, Municipal)"
  - "Dedicated 'Required Permits' section at end of answer for actionable permit list"
  - "Numbered chunks [1], [2], [3] in user prompt enable citation tracking"

patterns-established:
  - "Confidence based on retrieval metrics only (avgSimilarity, jurisdictionCoverage, citationCoverage)"
  - "System prompt instructs Claude to cite all claims using [N] format, never make uncited claims"
  - "buildCitationList generates formatted references for UI/CLI display"
  - "Prompt includes instructions for handling conflicts and incomplete coverage"

# Metrics
duration: 1.6min
completed: 2026-02-03
---

# Phase 7 Plan 3: Confidence Scoring & Prompt Templates Summary

**Retrieval-based confidence scoring (50% similarity, 30% coverage, 20% citations) and Claude prompts with jurisdiction sections and numbered citations**

## Performance

- **Duration:** 1.6 min
- **Started:** 2026-02-03T21:00:53Z
- **Completed:** 2026-02-03T21:02:27Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Confidence scoring uses retrieval metrics, not LLM self-assessment (research-backed approach)
- Claude prompt templates organize answers by jurisdiction hierarchy (Federal, State, County, Municipal)
- Numbered chunk format [1], [2], [3] enables precise citation tracking in generated answers
- Dedicated "Required Permits" section provides actionable permit list for lawyers

## Task Commits

Each task was committed atomically:

1. **Task 1: Create confidence scoring module** - `ef2ca31` (feat)
2. **Task 2: Create Claude prompt templates** - `1f91bca` (feat)

## Files Created/Modified
- `apps/convex/convex/lib/confidence.ts` - calculateConfidence with weighted scoring (50% similarity, 30% jurisdiction coverage, 20% citation coverage)
- `apps/convex/convex/lib/prompt.ts` - SYSTEM_PROMPT, buildSystemPrompt, buildUserPrompt, buildCitationList for RAG answer generation

## Decisions Made

**1. Weighted confidence scoring formula**
- 50% semantic similarity (most important - how relevant are chunks)
- 30% jurisdiction coverage (comprehensive regulatory coverage)
- 20% citation coverage (traceability and legal compliance)
- High confidence requires score > 0.8 AND full jurisdiction coverage (prevents false confidence)
- Rationale: Balanced approach values relevance while ensuring comprehensive coverage

**2. Jurisdiction-layered response structure**
- Separate sections for Federal, State, County, Municipal regulations
- Helps lawyers understand which level imposes which requirements
- Matches CONTEXT.md decision for clear delineation by jurisdiction level
- Rationale: Lawyers need to know which government level is responsible

**3. Numbered citation format [N]**
- Chunks numbered [1], [2], [3] in user prompt
- Claude instructed to cite all claims using [N] format
- buildCitationList generates formatted references for UI/CLI
- Rationale: Precise citation tracking essential for legal compliance

**4. Dedicated "Required Permits" section**
- Separate section at end of answer (not inline)
- Includes permit name, issuing agency, jurisdiction, link, regulatory reference
- Rationale: Actionable list lawyers can hand to clients per CONTEXT.md

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Claude API integration will be configured in next plan (07-04: Answer Generation).

## Next Phase Readiness

**Ready for next phase:**
- Confidence scoring ready for integration in query pipeline
- Prompt templates ready for Claude API calls
- All TypeScript types properly imported from query/types
- Confidence metrics provide transparency for lawyers

**Dependencies for next plans:**
- Plan 07-04: Claude answer generation (use prompt templates to generate answers)
- Plan 07-05: Query orchestration (integrate confidence scoring into pipeline)
- Plan 07-06: Test script (use buildCitationList for CLI output)

**No blockers or concerns.**

---
*Phase: 07-query-pipeline*
*Completed: 2026-02-03*
