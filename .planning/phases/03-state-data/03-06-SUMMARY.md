---
phase: 03-state-data
plan: 06
subsystem: data-pipeline
tags: [texas, pipeline, orchestration, pinecone, checkpointing, http-endpoints]

# Dependencies
requires:
  - 03-04-PLAN.md  # Texas storage (storeTexasStatute, storeTACRule, checkpoint functions)
  - 03-05-PLAN.md  # TAC scraper + chunking (fetchTACTitle, chunkTACRule)
  - 02-06-PLAN.md  # Federal pipeline pattern (embedChunks, upsertChunks)

provides:
  - apps/workers/src/texas/pipeline.ts
  - POST /pipeline/texas HTTP endpoint
  - POST /pipeline/texas/statutes HTTP endpoint
  - POST /pipeline/texas/tac HTTP endpoint
  - POST /pipeline/texas/statutes/:code HTTP endpoint
  - POST /pipeline/texas/tac/:title HTTP endpoint

affects:
  - 04-*  # Query implementation will use Pinecone vectors with TX jurisdiction
  - 05-*  # Citations will reference Texas sources
  - 06-*  # UI will display Texas regulatory content

# Technical Stack
tech-stack:
  added: []
  patterns:
    - "Checkpoint-based resumption for fault tolerance"
    - "Sequential processing to avoid API overload"
    - "Best-effort Convex sync (non-blocking)"
    - "Batch embedding generation (64 chunks per batch)"
    - "Graceful error handling (continue on individual failures)"

# Files
key-files:
  created:
    - apps/workers/src/texas/pipeline.ts  # Pipeline orchestrator
  modified:
    - apps/workers/src/index.ts  # Added 5 Texas HTTP endpoints
    - apps/workers/src/texas/index.ts  # Export pipeline functions

# Decisions
decisions:
  - id: checkpoint-per-source-type
    choice: "Separate checkpoints for statute and tac pipelines"
    rationale: "Independent progress tracking allows resuming statutes or TAC separately"
    alternatives: ["Single combined checkpoint", "No checkpointing"]

  - id: state-sourceType-for-pinecone
    choice: "Use 'state' sourceType in Pinecone metadata (not 'tx-statute' or 'tx-tac')"
    rationale: "ChunkMetadata type requires 'federal' | 'state' | 'county' | 'municipal'"
    alternatives: ["Extend ChunkMetadata to include Texas-specific types", "Use federal type"]

  - id: sequential-code-processing
    choice: "Process 27 codes and 5 titles sequentially, not in parallel"
    rationale: "Avoids overwhelming capitol.texas.gov and sos.state.tx.us APIs"
    alternatives: ["Parallel processing with semaphore", "Worker queue distribution"]

  - id: reuse-federal-embedChunks
    choice: "Reuse embedChunks from federal/embed.ts via type assertion"
    rationale: "TexasChunk and CFRChunk share same embedding interface (text, chunkId)"
    alternatives: ["Create Texas-specific embed function", "Generic embedChunks<T>"]

# Performance
metrics:
  duration: 259s  # ~4.3 minutes
  completed: 2026-02-01

---

# Phase 3 Plan 6: Texas Pipeline Orchestration Summary

**One-liner:** End-to-end Texas data pipeline with checkpoint resumption, Pinecone indexing, and HTTP endpoints for 27 statute codes and 5 TAC titles

## What Was Built

### Pipeline Orchestrator (`apps/workers/src/texas/pipeline.ts`)

**Core Functions:**
- `processTexasCode()` - Process single statute code (fetch → store → chunk → embed → index)
- `processTexasTACTitle()` - Process single TAC title (fetch → store → chunk → embed → index)
- `processTexasStatutes()` - Process all 27 statute codes with checkpointing
- `processTexasTAC()` - Process all 5 TAC titles with checkpointing
- `processAllTexasSources()` - Complete Texas pipeline (statutes + TAC)
- `syncConvexTexasSources()` - Best-effort freshness sync to Convex

**Pipeline Flow:**
1. Load checkpoint (if exists) for resumption
2. Fetch sections/rules via AsyncGenerator (fetchTexasCode/fetchTACTitle)
3. Store raw HTML in R2 (storeTexasStatute/storeTACRule)
4. Chunk sections/rules (chunkTexasStatute/chunkTACRule)
5. Generate embeddings via OpenAI (embedChunks from federal pipeline)
6. Prepare Pinecone records with metadata:
   - `jurisdiction: "TX"`
   - `sourceType: "state"`
   - `citation` in Bluebook format
   - `category` from code/title config
7. Upsert vectors to Pinecone
8. Save checkpoint after each code/title
9. Clear checkpoint on completion
10. Sync to Convex (non-blocking)

**Error Handling:**
- Individual section/rule failures logged but don't stop pipeline
- Checkpoint saved after each successful code/title
- Failed codes/titles tracked in results array
- Convex sync failures are non-fatal

**Result Interfaces:**
- `TexasPipelineResult` - Single code/title statistics
- `TexasBatchPipelineResult` - Aggregated batch statistics

### HTTP Endpoints (`apps/workers/src/index.ts`)

**Added 5 Texas endpoints:**
1. `POST /pipeline/texas` - Full pipeline (27 codes + 5 titles)
2. `POST /pipeline/texas/statutes` - All statute codes only
3. `POST /pipeline/texas/tac` - All TAC titles only
4. `POST /pipeline/texas/statutes/:code` - Single code (e.g., `/pipeline/texas/statutes/PE`)
5. `POST /pipeline/texas/tac/:title` - Single title (e.g., `/pipeline/texas/tac/16`)

**Response Format:**
```json
{
  "success": true,
  "statutesProcessed": 27,
  "tacTitlesProcessed": 5,
  "totalChunks": 15000,
  "totalVectors": 15000,
  "durationMs": 3600000,
  "results": [...]
}
```

### Module Exports (`apps/workers/src/texas/index.ts`)

**Pipeline exports added:**
- `processTexasCode`
- `processTexasTACTitle`
- `processTexasStatutes`
- `processTexasTAC`
- `processAllTexasSources`
- `TexasPipelineResult` (type)
- `TexasBatchPipelineResult` (type)

## Technical Implementation

### Checkpoint Resumption

**Checkpoint Structure:**
```typescript
{
  sourceType: 'statute' | 'tac',
  lastProcessedCode?: string,      // For statutes
  lastProcessedTitle?: number,     // For TAC
  timestamp: string,
  chunksProcessed: number,
  status: 'in_progress' | 'completed' | 'failed',
  error?: string
}
```

**Storage:**
- Statutes: `texas/checkpoints/statute.json`
- TAC: `texas/checkpoints/tac.json`

**Resume Logic:**
1. Load checkpoint on pipeline start
2. Skip codes/titles already processed
3. Resume from next code/title after checkpoint
4. Clear checkpoint on successful completion

### Pinecone Metadata

**Metadata Schema:**
```typescript
{
  chunkId: "tx-statute-PE-30-30.02-0",
  sourceId: "tx-statute-PE",
  sourceType: "state",
  jurisdiction: "TX",
  text: "Section text...",
  citation: "Tex. Penal Code Ann. § 30.02 (West 2026)",
  chunkIndex: 0,
  totalChunks: 1,
  category: "criminal",
  indexedAt: "2026-02-01T22:45:33Z"
}
```

**Design Decision:**
- Used `sourceType: "state"` (not `"tx-statute"` or `"tx-tac"`) to match existing `ChunkMetadata` type
- Alternative would be extending `ChunkMetadata` to support Texas-specific types (deferred to future)

### Batch Processing

**Embedding:**
- Reuses `embedChunks()` from `federal/embed.ts`
- 64 chunks per batch (OpenAI recommendation)
- 100ms delay between batches
- Type assertion for TexasChunk→CFRChunk compatibility

**Pinecone Upsert:**
- Reuses `upsertChunks()` from `pinecone.ts`
- 100 vectors per batch
- Automatic batching handled by library

### Convex Sync

**Best-Effort Approach:**
- Calls `sources:updateTexasStatus` mutation
- Failures logged but don't fail pipeline
- Payload includes:
  - `status: "complete" | "error"`
  - `lastScrapedAt: number`
  - `statutesProcessed: number`
  - `tacTitlesProcessed: number`
  - `totalVectors: number`
  - `durationMs: number`

## Testing Evidence

### TypeScript Compilation
```bash
pnpm -F @compliance-iq/workers exec tsc --noEmit
# No errors in pipeline.ts, index.ts, texas/index.ts
```

### Worker Build
```bash
pnpm wrangler deploy --dry-run
# Total Upload: 7498.26 KiB / gzip: 2895.90 KiB
# Build successful
```

### Endpoint Structure Verified
- Health check lists all 9 endpoints (4 federal + 5 Texas)
- Route matching patterns tested:
  - Regex for `/pipeline/texas/statutes/:code` (2-letter uppercase)
  - Regex for `/pipeline/texas/tac/:title` (numeric)
  - Config lookup validates code/title existence

## Deviations from Plan

None - plan executed exactly as written.

## File Statistics

| File | Lines Added | Purpose |
|------|-------------|---------|
| apps/workers/src/texas/pipeline.ts | 675 | Pipeline orchestrator |
| apps/workers/src/index.ts | 152 | HTTP endpoints |
| apps/workers/src/texas/index.ts | 11 | Module exports |
| **Total** | **838** | |

## Integration Points

### Dependencies Used
1. **03-04 (Storage):**
   - `storeTexasStatute()`, `storeTACRule()` - R2 storage
   - `saveTexasCheckpoint()`, `loadTexasCheckpoint()`, `clearTexasCheckpoint()` - Checkpoint management

2. **03-05 (Chunking):**
   - `chunkTexasStatute()`, `chunkTACRule()` - Section/rule chunking
   - `TexasChunkContext`, `TACChunkContext` - Chunk context types

3. **03-03 (Fetchers):**
   - `fetchTexasCode()` - AsyncGenerator for statute sections
   - `fetchTACTitle()` - AsyncGenerator for TAC rules

4. **02-06 (Federal Pipeline):**
   - `embedChunks()` - OpenAI embedding generation
   - Pattern: Sequential processing, checkpoint resumption

5. **01-06 (Pinecone):**
   - `initPinecone()`, `getIndex()`, `upsertChunks()` - Vector indexing

### Provides to Future Phases
1. **Phase 4 (Query):**
   - Pinecone vectors with `jurisdiction: "TX"` filter
   - `sourceType: "state"` for Texas-specific queries
   - `category` metadata for filtered searches

2. **Phase 5 (Citations):**
   - Bluebook citations: "Tex. Penal Code Ann. § 30.02 (West 2026)"
   - `url` field with direct links to capitol.texas.gov/sos.state.tx.us

3. **Phase 6 (UI):**
   - HTTP endpoints for manual pipeline triggering
   - Progress tracking via batch results
   - Error reporting for failed codes/titles

## Next Phase Readiness

### Blockers
None.

### Concerns
1. **Untested at scale:**
   - Pipeline not yet run against all 27 codes (hundreds of sections each)
   - Unknown total processing time and vector count
   - Risk: API rate limits or memory issues during full run

2. **Pre-existing TypeScript errors:**
   - `fetch-statutes.ts` and `parse-statutes.ts` have type safety issues
   - These don't block the build (Wrangler compiles anyway)
   - Should be fixed before production deployment

3. **HTML storage simplified:**
   - Currently storing synthetic HTML (`<html><body>${text}</body></html>`)
   - Should store actual fetched HTML from capitol.texas.gov
   - Requires refactoring fetchers to return both HTML and parsed data

### Recommendations
1. **Before Phase 4:**
   - Run small-scale test: single code (PE) and single title (16)
   - Verify Pinecone vectors queryable with TX jurisdiction
   - Monitor API rate limits and adjust delays if needed

2. **Production hardening:**
   - Fix TypeScript errors in fetch/parse modules
   - Store actual HTML in R2 (not synthetic)
   - Add integration tests for pipeline functions
   - Implement rate limit monitoring and adaptive backoff

## Commits

| Task | Commit | Files Modified |
|------|--------|----------------|
| 1 - Pipeline orchestrator | 997dc04 | apps/workers/src/texas/pipeline.ts (+675) |
| 2 - HTTP endpoints | 42ba15d | apps/workers/src/index.ts (+152) |
| 3 - Module exports | 0ead3ae | apps/workers/src/texas/index.ts (+11) |

**Total:** 3 commits, 838 lines added
