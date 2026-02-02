# Phase 6: Data Processing - Research

**Researched:** 2026-02-02
**Domain:** Data pipeline validation, embedding generation, vector storage
**Confidence:** HIGH

## Summary

Phase 6 validates the end-to-end data processing pipeline built across Phases 1-5. The infrastructure is already in place: chunking, embedding generation (OpenAI text-embedding-3-large), vector storage (Pinecone), raw document storage (R2), and data freshness tracking (Convex). This phase focuses on validation, testing, documentation, and quality reporting rather than new infrastructure.

The standard approach for regulatory text processing pipelines in 2026 emphasizes:
1. **Shift-left testing** with automated validation embedded in CI/CD
2. **Multi-layer quality metrics** tracking accuracy, completeness, coverage, and freshness
3. **Source-to-target validation** ensuring data integrity from ingestion through retrieval
4. **Comprehensive documentation** of chunking strategies, metadata schemas, and R2 folder structures

**Primary recommendation:** Build a validation suite that tests the pipeline end-to-end with sample data from each jurisdiction, generates quality metrics reports (chunk counts, token distributions, coverage gaps), and documents the established patterns for future phases.

## Standard Stack

The project has already adopted industry-standard tools for 2026:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| OpenAI | 6.17.0 | Embedding generation via text-embedding-3-large | Industry standard for high-quality semantic embeddings (3072 dimensions) |
| @pinecone-database/pinecone | 6.1.4 | Vector storage and similarity search | Leading vector database with mature SDK, excellent performance, and metadata filtering |
| js-tiktoken | 1.0.21 | Token counting for chunking validation | Official OpenAI tokenizer for accurate token measurement |
| Cloudflare R2 | Native | Raw document storage with zero-egress fees | Cost-effective object storage with built-in metadata support |
| Convex | N/A | Data freshness tracking and metrics | Real-time database for pipeline metadata and status tracking |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 2.1.8 | Testing framework | Unit tests for chunking, validation logic, and data quality checks |
| fast-xml-parser | 5.3.4 | XML parsing for CFR data | Federal pipeline (already in use) |
| Cheerio | 1.2.0 | HTML parsing for statutes/ordinances | State/county/municipal pipelines (already in use) |
| Zod | 4.3.6 | Schema validation | Runtime type checking for pipeline data structures |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pinecone | Weaviate, Milvus, Qdrant | Self-hosting offers more control but requires infrastructure management; Pinecone's managed service fits MVP needs |
| text-embedding-3-large | text-embedding-3-small, ada-002 | Smaller models are cheaper but less accurate; 3072 dimensions in large model provide superior semantic understanding |
| Cloudflare R2 | AWS S3, GCS | R2's zero-egress fees significantly reduce costs for compliance document storage |

**Installation:**
```bash
# All dependencies already installed in apps/workers/package.json
cd apps/workers
pnpm install
```

## Architecture Patterns

### Current Pipeline Structure (Already Built)
```
apps/workers/src/
├── federal/           # CFR pipeline
│   ├── fetch.ts      # eCFR API integration
│   ├── chunk.ts      # Section-level chunking
│   ├── embed.ts      # OpenAI embedding generation
│   ├── storage.ts    # R2 storage with checkpoints
│   └── pipeline.ts   # End-to-end orchestration
├── texas/            # State statutes + TAC pipeline
│   ├── fetch-*.ts    # Data fetching
│   ├── chunk.ts      # Statute chunking
│   └── pipeline.ts   # State pipeline orchestration
├── counties/         # County ordinance pipeline (10 counties)
│   ├── adapters/     # Platform-specific parsers
│   ├── chunk.ts      # County chunking
│   └── index.ts      # County pipeline orchestration
├── municipal/        # Municipal ordinance pipeline (20 cities)
│   ├── fetch.ts      # Firecrawl integration
│   ├── chunk.ts      # Municipal chunking
│   └── pipeline.ts   # Municipal pipeline orchestration
├── lib/              # Shared utilities
│   ├── tokens.ts     # Token counting
│   ├── citations.ts  # Bluebook citation generation
│   └── r2.ts         # R2 storage helpers
└── pinecone.ts       # Pinecone integration
```

### Pattern 1: Chunking Strategy (Implemented)
**What:** Structure-aware chunking that preserves legal hierarchy
**When to use:** All regulatory text processing (federal, state, county, municipal)
**Implementation:**
```typescript
// Source: apps/workers/src/federal/chunk.ts
export function chunkCFRSection(section: CFRSection, context: ChunkContext): CFRChunk[] {
  const tokenCount = countTokens(section.text);

  // Strategy 1: Keep small sections whole (≤ 1500 tokens)
  if (tokenCount <= MAX_CHUNK_TOKENS) {
    return [createSingleChunk(section, context)];
  }

  // Strategy 2: Split at subsection boundaries
  const subsections = splitAtSubsections(section.text);
  if (subsections.length > 0) {
    return subsections.map(sub => chunkSubsection(sub, context));
  }

  // Strategy 3: Split at paragraph boundaries with 15% overlap
  return splitWithOverlap(section.text, MAX_CHUNK_TOKENS, 0.15);
}
```

**Key decisions (from existing code):**
- 1500 token maximum per chunk (well under 8191 limit, allows metadata headroom)
- 15% overlap ratio for cross-reference context preservation
- Three-tier fallback: whole section → subsection split → paragraph split

### Pattern 2: Batch Embedding Generation (Implemented)
**What:** OpenAI API calls with batching, rate limiting, and retry logic
**When to use:** Converting chunks to vectors
**Implementation:**
```typescript
// Source: apps/workers/src/federal/embed.ts
export async function embedChunks(
  chunks: CFRChunk[],
  apiKey: string,
  onProgress?: ProgressCallback
): Promise<EmbeddedChunk[]> {
  const BATCH_SIZE = 64; // OpenAI recommendation for text-embedding-3-large
  const BATCH_DELAY_MS = 100;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);

    // Validate token counts before API call
    for (const chunk of batch) {
      validateChunkSize(chunk.text, 8191);
    }

    // Generate embeddings with retry logic
    const embeddings = await generateEmbeddings(batch.map(c => c.text), apiKey);

    // Combine with chunks
    results.push(...batch.map((chunk, idx) => ({ chunk, embedding: embeddings[idx] })));

    // Rate limit protection
    if (i + BATCH_SIZE < chunks.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return results;
}
```

**Current settings:**
- 64 chunks per batch (OpenAI best practice for text-embedding-3-large)
- 100ms delay between batches
- Exponential backoff for rate limit errors (1s, 2s, 4s, 8s)
- Pre-validation of token counts to avoid API errors

### Pattern 3: Pinecone Upsert with Metadata (Implemented)
**What:** Batch vector upserts with comprehensive metadata for filtering
**When to use:** Indexing all embedded chunks
**Implementation:**
```typescript
// Source: apps/workers/src/federal/pipeline.ts and apps/workers/src/pinecone.ts
const records = embedded.map(({ chunk, embedding }) => ({
  id: chunk.chunkId,
  values: embedding,
  metadata: {
    chunkId: chunk.chunkId,
    sourceId: chunk.sourceId,
    sourceType: 'federal' as const,
    jurisdiction: 'US',
    text: chunk.text,
    citation: chunk.citation,
    chunkIndex: chunk.chunkIndex,
    totalChunks: chunk.totalChunks,
    category: chunk.category,
    indexedAt: new Date().toISOString(),
  },
}));

// Upsert in batches of 100 (Pinecone recommendation)
await upsertChunks(index, records);
```

**Metadata schema (already defined):**
```typescript
// Source: apps/workers/src/pinecone.ts
export type ChunkMetadata = RecordMetadata & {
  chunkId: string;           // Unique chunk identifier
  sourceId: string;          // Source document identifier
  sourceType: 'federal' | 'state' | 'county' | 'municipal';
  jurisdiction: string;      // 'US', 'TX', 'TX-{fipsCode}', 'TX-{cityId}'
  text: string;              // Full chunk text
  citation: string;          // Bluebook citation
  title?: string;            // Section title/heading
  chunkIndex: number;        // Position in document
  totalChunks: number;       // Total chunks in document
  category?: string;         // Activity tag (e.g., 'food-safety')
  indexedAt: string;         // ISO timestamp
  lastUpdated?: string;      // Last known update to source
};
```

### Pattern 4: R2 Folder Structure (Implemented)
**What:** Hierarchical organization using pseudo-folders with metadata
**When to use:** Storing raw regulatory documents for audit/reprocessing
**Implementation:**
```typescript
// Source: Decision from STATE.md
// R2 folder structure patterns:

// Federal CFR: federal/cfr/title-X/part-Y.xml
await storeDocument(
  bucket,
  `federal/cfr/title-21/part-117.xml`,
  xmlContent,
  {
    source: 'eCFR',
    dataType: 'raw-regulation',
    fetchedAt: new Date().toISOString(),
    titleNumber: '21',
    partNumber: '117',
  }
);

// Texas Statutes: texas/statutes/{code}/chapter-{chapter}/{section}.html
await storeDocument(
  bucket,
  `texas/statutes/PE/chapter-30/30.02.html`,
  htmlContent,
  { source: 'Texas SOS', dataType: 'raw-statute', code: 'PE', chapter: '30' }
);

// Texas TAC: texas/tac/title-{title}/chapter-{chapter}/{section}.html
await storeDocument(
  bucket,
  `texas/tac/title-16/chapter-5/5.31.html`,
  htmlContent,
  { source: 'Texas SOS', dataType: 'raw-regulation', tacTitle: '16', chapter: '5' }
);

// Counties: counties/{fipsCode}/chapter-{chapter}/{section}.html
await storeDocument(
  bucket,
  `counties/48201/chapter-subdivision/section-1.html`,
  htmlContent,
  { source: 'Harris County', dataType: 'raw-ordinance', fipsCode: '48201' }
);

// Municipal: municipal/{cityId}/chapter-{chapter}/{section}.json
await storeDocument(
  bucket,
  `municipal/houston/chapter-1/section-1-2.json`,
  JSON.stringify(ordinanceData),
  { source: 'Municode', dataType: 'raw-ordinance', cityId: 'houston' }
);
```

### Pattern 5: Convex Sync for Freshness Tracking (Implemented)
**What:** Workers call Convex mutations after pipeline completion to update freshness metrics
**When to use:** After each pipeline run completes (federal, state, county, municipal)
**Implementation:**
```typescript
// Source: apps/convex/convex/sources.ts and jurisdictions.ts
// Federal pipeline calls updateFederalStatus after completion
await convex.mutation('sources:updateFederalStatus', {
  status: 'complete',
  lastScrapedAt: Date.now(),
  titlesProcessed: 7,
  totalVectors: 15234,
  durationMs: 45000,
});

// County pipeline calls updateCountyStatus per county
await convex.mutation('jurisdictions:updateCountyStatus', {
  fipsCode: '48201',
  status: 'active',
  lastScrapedAt: Date.now(),
  vectorCount: 432,
});

// Municipal pipeline calls updateCityStatus per city
await convex.mutation('jurisdictions:updateCityStatus', {
  cityId: 'houston',
  status: 'active',
  lastScrapedAt: Date.now(),
  vectorCount: 1250,
});
```

### Anti-Patterns to Avoid

- **Don't chunk arbitrarily**: Always respect legal structure (sections, subsections). Arbitrary token splits mid-sentence break semantic coherence.
- **Don't skip validation**: Pre-validate all chunks before embedding to catch token limit issues early, not during expensive API calls.
- **Don't ignore rate limits**: Always implement delays and exponential backoff. OpenAI and Pinecone have strict rate limits.
- **Don't lose metadata**: Every chunk must carry full citation, jurisdiction, and hierarchy context for accurate retrieval.
- **Don't duplicate data in metadata**: R2 stores raw documents, Pinecone stores vectors + chunk text. Don't also store chunks in Convex—use it only for tracking metrics.

## Don't Hand-Roll

Problems with existing solutions (already implemented):

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Custom regex-based estimators | js-tiktoken | OpenAI's official tokenizer; regex estimates are inaccurate and cause API errors |
| Embedding generation | Custom vector models | OpenAI text-embedding-3-large | State-of-art semantic understanding, proven for RAG, cost-effective at scale |
| Vector storage | DIY vector search with pgvector | Pinecone managed service | Production-ready with metadata filtering, auto-scaling, and low latency |
| Retry logic | Manual setTimeout loops | Exponential backoff with jitter | Prevents thundering herd, respects rate limits, proven pattern |
| Chunk overlap | Simple sliding window | Structure-aware overlap at paragraph boundaries | Preserves sentence integrity and cross-reference context |

**Key insight:** The existing implementation already follows best practices. Don't rebuild these components—focus validation efforts on testing end-to-end flows and documenting what's been built.

## Common Pitfalls

### Pitfall 1: Token Count Mismatch Between Chunking and Embedding
**What goes wrong:** Chunks pass token validation during chunking but fail during embedding API calls due to different tokenizers.
**Why it happens:** Using approximate token counting (character-based estimates) instead of OpenAI's actual tokenizer (cl100k_base).
**How to avoid:** Always use `js-tiktoken` with `cl100k_base` encoding for token counting. The existing code does this correctly in `apps/workers/src/lib/tokens.ts`.
**Warning signs:** API errors like "This model's maximum context length is 8191 tokens" despite pre-validation.

### Pitfall 2: Lost Context at Chunk Boundaries
**What goes wrong:** Chunks reference "as defined in paragraph (a)" but paragraph (a) is in a different chunk, breaking semantic coherence.
**Why it happens:** No overlap between chunks, or overlap that doesn't preserve full sentences.
**How to avoid:** Use 15% overlap calculated at paragraph boundaries (already implemented). Validate that cross-references within 15% of chunk size remain intact.
**Warning signs:** RAG retrieval returning isolated regulatory text without necessary context.

### Pitfall 3: Incomplete Coverage Tracking
**What goes wrong:** Pipeline reports "success" but only processed 60% of target jurisdictions, leaving coverage gaps unnoticed.
**Why it happens:** No validation of total expected sources vs. actually processed sources.
**How to avoid:**
- Maintain target lists (TARGET_TITLES, TARGET_STATUTES, TARGET_COUNTIES, TARGET_CITIES—already defined)
- Generate coverage reports comparing actual vs. expected
- Track skipped sources with skip reasons
**Warning signs:** User queries failing to find regulations that should be indexed.

### Pitfall 4: Metadata Inconsistency Across Jurisdictions
**What goes wrong:** Federal chunks have `category` metadata, but county chunks don't, breaking filter queries.
**Why it happens:** Different pipeline implementations with inconsistent metadata schemas.
**How to avoid:** The existing `ChunkMetadata` type in `pinecone.ts` defines a unified schema. Validate all chunks conform to this schema before upsert. Use TypeScript's type system to catch mismatches at compile time.
**Warning signs:** Pinecone queries returning incomplete results when filtering by metadata fields.

### Pitfall 5: R2 Storage Without Audit Metadata
**What goes wrong:** Raw documents stored in R2 lack `fetchedAt` timestamps, making it impossible to determine data freshness or identify stale documents.
**Why it happens:** Skipping metadata during R2 storage to save development time.
**How to avoid:** Always use `storeDocument()` helper (implemented in `lib/r2.ts`) which enforces metadata requirements. Never use `bucket.put()` directly.
**Warning signs:** Unable to answer "when was this regulation last updated?" questions during audits.

### Pitfall 6: No End-to-End Validation
**What goes wrong:** Individual pipeline stages work (chunk → embed → upsert) but full flow fails due to integration issues.
**Why it happens:** Testing each function in isolation without testing the complete pipeline flow.
**How to avoid:** Build integration tests that run sample data through the entire pipeline:
1. Fetch sample regulation
2. Chunk it
3. Embed chunks
4. Upsert to Pinecone
5. Query by metadata
6. Verify retrieved text matches source
**Warning signs:** Production pipeline failures that weren't caught in unit tests.

## Code Examples

Verified patterns from existing implementation:

### Validation Pattern: Pre-Flight Token Check
```typescript
// Source: apps/workers/src/federal/embed.ts
export async function generateEmbeddings(texts: string[], apiKey: string): Promise<number[][]> {
  // Validate all texts before API call
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;

    const validation = validateChunkSize(text, 8191); // text-embedding-3-large limit
    if (!validation.valid) {
      throw new EmbeddingError(
        `Text at index ${i} exceeds token limit: ${validation.tokens} tokens (max 8191)`,
        'TOKEN_LIMIT',
        { index: i, tokens: validation.tokens }
      );
    }
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-large',
    input: texts,
    encoding_format: 'float',
  });

  return response.data.map(d => d.embedding);
}
```

### Validation Pattern: Chunk Statistics Collection
```typescript
// Source: apps/workers/src/federal/chunk.ts
export function getChunkStats(chunks: CFRChunk[]): ChunkStats {
  let totalTokens = 0;
  let maxTokens = 0;
  const uniqueSections = new Set<string>();
  let oversizedSections = 0;

  for (const chunk of chunks) {
    const tokens = countTokens(chunk.text);
    totalTokens += tokens;
    maxTokens = Math.max(maxTokens, tokens);

    // Track unique sections
    const sectionKey = `${chunk.title}-${chunk.section}`;
    uniqueSections.add(sectionKey);

    // Count sections that required splitting (totalChunks > 1)
    if (chunk.totalChunks > 1 && chunk.chunkIndex === 0) {
      oversizedSections++;
    }
  }

  return {
    totalChunks: chunks.length,
    totalTokens,
    avgTokensPerChunk: chunks.length > 0 ? totalTokens / chunks.length : 0,
    maxTokensChunk: maxTokens,
    sectionsChunked: uniqueSections.size,
    oversizedSections,
  };
}
```

### Validation Pattern: Coverage Report Generation
```typescript
// Source: New pattern for Phase 6 validation
interface CoverageReport {
  totalExpected: number;
  totalProcessed: number;
  coveragePercent: number;
  byJurisdiction: {
    federal: { expected: number; processed: number };
    state: { expected: number; processed: number };
    county: { expected: number; processed: number };
    municipal: { expected: number; processed: number };
  };
  gaps: Array<{ jurisdiction: string; source: string; reason: string }>;
}

async function generateCoverageReport(env: Env): Promise<CoverageReport> {
  // Query Pinecone for distinct sourceIds
  const federal = await queryDistinctSources(index, 'federal');
  const state = await queryDistinctSources(index, 'state');
  const county = await queryDistinctSources(index, 'county');
  const municipal = await queryDistinctSources(index, 'municipal');

  // Compare against targets
  const report = {
    totalExpected: TARGET_TITLES.length + TARGET_STATUTES.length +
                   TARGET_COUNTIES.length + TARGET_CITIES.length,
    totalProcessed: federal.length + state.length + county.length + municipal.length,
    coveragePercent: 0, // Calculate below
    byJurisdiction: {
      federal: { expected: TARGET_TITLES.length, processed: federal.length },
      state: { expected: TARGET_STATUTES.length, processed: state.length },
      county: { expected: TARGET_COUNTIES.length, processed: county.length },
      municipal: { expected: TARGET_CITIES.length, processed: municipal.length },
    },
    gaps: [],
  };

  report.coveragePercent = Math.round(
    (report.totalProcessed / report.totalExpected) * 100
  );

  // Identify gaps
  for (const title of TARGET_TITLES) {
    if (!federal.includes(`cfr-title-${title.number}`)) {
      report.gaps.push({
        jurisdiction: 'federal',
        source: `CFR Title ${title.number}`,
        reason: 'Not yet processed',
      });
    }
  }

  // Repeat for other jurisdictions...

  return report;
}
```

### Validation Pattern: Data Quality Metrics
```typescript
// Source: New pattern for Phase 6 validation
interface DataQualityReport {
  timestamp: string;
  totalChunks: number;
  tokenDistribution: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  citationCoverage: number; // Percentage of chunks with valid citations
  metadataCompleteness: {
    hasCategory: number;
    hasUrl: number;
    hasHierarchy: number;
  };
  brokenReferences: Array<{
    chunkId: string;
    issue: string;
  }>;
}

async function generateQualityReport(chunks: CFRChunk[]): Promise<DataQualityReport> {
  const tokenCounts = chunks.map(c => countTokens(c.text)).sort((a, b) => a - b);

  return {
    timestamp: new Date().toISOString(),
    totalChunks: chunks.length,
    tokenDistribution: {
      min: Math.min(...tokenCounts),
      max: Math.max(...tokenCounts),
      avg: tokenCounts.reduce((sum, t) => sum + t, 0) / tokenCounts.length,
      p50: tokenCounts[Math.floor(tokenCounts.length * 0.5)],
      p95: tokenCounts[Math.floor(tokenCounts.length * 0.95)],
      p99: tokenCounts[Math.floor(tokenCounts.length * 0.99)],
    },
    citationCoverage: (chunks.filter(c => c.citation).length / chunks.length) * 100,
    metadataCompleteness: {
      hasCategory: chunks.filter(c => c.category).length,
      hasUrl: chunks.filter(c => c.url).length,
      hasHierarchy: chunks.filter(c => c.hierarchy).length,
    },
    brokenReferences: [], // Would detect broken cross-references
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Character-based chunking | Token-based chunking with tiktoken | 2023 (GPT-3.5-turbo) | Eliminates API errors from token limit mismatches |
| text-embedding-ada-002 (1536 dims) | text-embedding-3-large (3072 dims) | Jan 2024 | 2x semantic richness, better RAG accuracy |
| Manual batch size tuning | API-recommended batch sizes (64 for embeddings, 100 for upsert) | 2023-2024 | Optimal throughput without rate limiting |
| Single-stage validation | Multi-stage validation (pre-chunk, pre-embed, pre-upsert, post-index) | 2025-2026 | Catches errors early, reduces API costs |
| Fixed chunking (e.g., 512 tokens) | Structure-aware chunking (sections → subsections → paragraphs) | 2024-2025 | Preserves legal hierarchy and context |

**Deprecated/outdated:**
- **text-embedding-ada-002**: Replaced by text-embedding-3-small/large in Jan 2024. The large model provides significantly better semantic understanding for regulatory text.
- **Character-based token estimation**: Always inaccurate. Use `js-tiktoken` with the model's actual encoding.
- **Synchronous pipeline processing**: Modern pipelines use batching, parallelization, and async/await patterns for throughput.

## Open Questions

Things that couldn't be fully resolved:

1. **Optimal overlap ratio for regulatory text**
   - What we know: 15% overlap is implemented based on general RAG best practices
   - What's unclear: Whether regulatory text (with heavy cross-referencing) benefits from higher overlap (20-25%)
   - Recommendation: Run A/B tests during Phase 6 validation comparing 15% vs. 20% overlap on retrieval accuracy for cross-referenced sections

2. **Long-term data freshness strategy**
   - What we know: Convex tracks `lastScrapedAt` for each source
   - What's unclear: How to trigger re-scraping when regulations update (no notification APIs exist for eCFR, Texas SOS, etc.)
   - Recommendation: Document manual re-scraping process for Phase 6; design automated staleness detection for future phase

3. **Chunk size optimization per jurisdiction**
   - What we know: 1500 tokens works well for federal CFR (technical, structured)
   - What's unclear: Whether county/municipal ordinances (less structured) would benefit from smaller chunks (1000-1200 tokens)
   - Recommendation: Generate token distribution reports per jurisdiction during Phase 6; adjust if p95 > 1400 tokens

4. **Metadata schema evolution**
   - What we know: Current `ChunkMetadata` schema covers MVP needs
   - What's unclear: Future needs like effective dates, amendment history, or multi-language support
   - Recommendation: Document metadata schema in Phase 6; design migration strategy for additive changes

## Sources

### Primary (HIGH confidence)
- [Pinecone Upsert Documentation](https://docs.pinecone.io/guides/index-data/upsert-data) - Official batch size recommendations (100 vectors), parallel processing strategies
- [OpenAI Embedding Long Inputs Cookbook](https://cookbook.openai.com/examples/embedding_long_inputs) - Token limits (8191), chunking vs truncation strategies
- Existing codebase analysis - All patterns verified from `apps/workers/src/` implementation

### Secondary (MEDIUM confidence)
- [The Best Way to Chunk Text Data for Generating Embeddings with OpenAI Models](https://dev.to/simplr_sh/the-best-way-to-chunk-text-data-for-generating-embeddings-with-openai-models-56c9) - 1000 token baseline, 20% overlap recommendation
- [Data Validation in ETL - 2026 Guide](https://www.integrate.io/blog/data-validation-etl/) - Shift-left testing, source-to-target validation patterns
- [Top 8 Data Quality Metrics in 2026](https://dagster.io/learn/data-quality-metrics) - Accuracy, completeness, validity, coverage metrics
- [Pinecone Vector Database: A Practical Starting Guide for 2026](https://thelinuxcode.com/pinecone-vector-database-a-practical-starting-guide-for-2026/) - Metadata schema best practices, filtering strategies
- [The continuous validation framework for data pipelines](https://platformengineering.org/blog/the-continuous-validation-framework-for-data-pipelines) - Multi-stage validation approaches

### Tertiary (LOW confidence)
- [Building Trust in Data II: A Guide to Effective Data Testing Tactics](https://community.databricks.com/t5/technical-blog/building-trust-in-data-ii-a-guide-to-effective-data-testing/ba-p/114316) - General data testing principles, not specific to vector pipelines

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified from package.json and official documentation
- Architecture: HIGH - All patterns extracted from existing, working code in apps/workers/src/
- Pitfalls: HIGH - Based on common RAG pipeline issues and existing code's defensive patterns (e.g., pre-validation, token checking)
- Validation patterns: MEDIUM - Code examples are new recommendations for Phase 6, not yet implemented

**Research date:** 2026-02-02
**Valid until:** 2026-03-02 (30 days - stable domain with established patterns)
