---
phase: 05-municipal-data
plan: 04
subsystem: municipal-chunking
tags: [chunking, tokens, overlap, bluebook, citations]
dependency-graph:
  requires: ["05-01", "05-03"]
  provides: ["chunkMunicipalOrdinance", "chunkCity", "getMunicipalChunkStats", "ChunkStats"]
  affects: ["05-05", "05-06"]
tech-stack:
  added: []
  patterns: [subsection-aware-chunking, paragraph-splitting-with-overlap, batch-processing]
key-files:
  created:
    - apps/workers/src/municipal/chunk.ts
  modified:
    - apps/workers/src/municipal/index.ts
decisions:
  - "1500 token maximum per chunk (matches federal/state/county patterns)"
  - "15% overlap for context preservation (matches established patterns)"
  - "Subsection splitting attempted before paragraph splitting"
  - "ChunkStats includes totalTokens for dry-run cost estimation"
metrics:
  duration: "~3 minutes"
  completed: "2026-02-02"
---

# Phase 05 Plan 04: Municipal Chunking Summary

**One-liner:** Subsection-aware chunking with 1500 token limit, 15% overlap, and Bluebook citations for municipal ordinances.

## What Was Built

Created municipal ordinance chunking module following the same patterns established in federal, state, and county data layers:

### Core Functions

1. **chunkMunicipalOrdinance(ordinance, cityConfig)** - Chunks single ordinance
   - Returns single chunk if text <= 1500 tokens
   - Splits at subsection boundaries when subsections exist
   - Falls back to paragraph splitting with 15% overlap
   - Generates Bluebook citation via `generateMunicipalCitation`
   - Includes hierarchy breadcrumbs via `generateMunicipalHierarchy`

2. **chunkCity(ordinances, cityConfig)** - Batch processes all ordinances for a city
   - Returns flat array of all chunks
   - Includes statistics for monitoring

3. **getMunicipalChunkStats(chunks)** - Calculate chunk statistics
   - totalChunks, totalTokens, avgTokens, minTokens, maxTokens
   - Used for dry-run validation before embedding

### Configuration Constants

- `MAX_TOKENS = 1500` - Well under 8192 embedding limit
- `OVERLAP_PERCENT = 0.15` - 15% overlap for context preservation

### Type Exports

- `ChunkStats` interface for statistics typing

## Files Changed

| File | Action | Purpose |
|------|--------|---------|
| apps/workers/src/municipal/chunk.ts | Created | Municipal chunking with subsection-aware splitting (381 lines) |
| apps/workers/src/municipal/index.ts | Modified | Export chunking functions from barrel |

## Key Patterns

### Chunking Strategy (Three Cases)

```
1. Single Chunk:     text <= 1500 tokens -> return as-is
2. Subsection Split: has subsections -> split at subsection boundaries
3. Paragraph Split:  no subsections -> split at paragraphs with 15% overlap
```

### Overlap Implementation

```typescript
// Calculate overlap tokens (15% of max)
const overlapTokens = Math.floor(maxTokens * OVERLAP_PERCENT);

// When starting new chunk, carry over last ~225 tokens from previous
const overlapText = getOverlapText(previousChunk, overlapTokens);
```

## Imports and Dependencies

| From | Imports | Purpose |
|------|---------|---------|
| `../lib/tokens` | `countTokens` | Token counting for chunk size |
| `../lib/citations` | `generateMunicipalCitation`, `generateMunicipalChunkId`, `generateMunicipalHierarchy` | Citation and ID generation |
| `./types` | `MunicipalOrdinance`, `MunicipalChunk`, `MunicipalCityConfig` | Type definitions |

## Verification Results

| Check | Status |
|-------|--------|
| TypeScript compiles | Pass (no errors in chunk.ts or index.ts) |
| MAX_TOKENS = 1500 | Verified |
| OVERLAP_PERCENT = 0.15 | Verified |
| Subsection split before paragraph split | Verified (lines 104-108) |
| Bluebook citations generated | Verified |
| ChunkStats tracking | Verified (5 metrics) |
| Min lines (100+) | Verified (381 lines) |

## Deviations from Plan

None - plan executed exactly as written.

## Commits

| Hash | Message |
|------|---------|
| 5a39041 | feat(05-04): create municipal chunking module |
| 5b3f8cf | feat(05-04): export chunking module from municipal/index.ts |

## Next Phase Readiness

Ready for 05-05 (Pipeline Orchestration):
- Chunking functions available via `municipal/index.ts`
- ChunkStats can be used for dry-run validation
- Pattern matches other jurisdictions for consistent pipeline code

## Notes

The chunking module follows the exact same pattern as:
- `apps/workers/src/federal/chunk.ts` (CFR chunking)
- `apps/workers/src/texas/chunk.ts` (Texas statutes/TAC)
- County chunking (embedded in county pipeline)

This consistency enables:
1. Reusable pipeline code
2. Predictable chunk sizes for embedding cost estimation
3. Standard overlap behavior for RAG context quality
