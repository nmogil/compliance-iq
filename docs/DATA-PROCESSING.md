# Data Processing Pipeline

**Last Updated:** 2026-02-03

---

## Overview

The data processing pipeline transforms regulatory documents from multiple jurisdictions into searchable vector embeddings stored in Pinecone. This enables semantic search across federal, state, county, and municipal regulations.

**Purpose:** Lawyers can query "how do I safely store perishable foods in Texas?" and get cited regulatory answers from 21 CFR 117, Texas Health & Safety Code, Harris County ordinances, and Houston city code.

**Pipeline Stages:**
1. **Fetch** - Scrape/download regulatory text from official sources
2. **Store** - Cache raw documents in R2 for reproducibility
3. **Chunk** - Split documents into embedding-sized pieces (≤1500 tokens)
4. **Embed** - Generate 3072-dimensional vectors via OpenAI
5. **Index** - Upsert vectors with metadata to Pinecone

**Source Types:**
- **Federal:** CFR titles from eCFR API
- **State:** Texas Statutes and TAC from capitol.texas.gov and sos.state.tx.us
- **County:** 10 Texas counties via Municode/eLaws platforms
- **Municipal:** 20 Texas cities via Firecrawl (Municode/American Legal)

---

## Chunking Strategy

### General Principles

All source types follow a **three-tier fallback strategy** to preserve legal structure while staying within token limits:

1. **Tier 1: Whole Section** - Keep entire section together if ≤1500 tokens
2. **Tier 2: Subsection Split** - Split at (a), (b), (1), (2) boundaries if section too large
3. **Tier 3: Paragraph Split** - Split at paragraph boundaries with 15% overlap as last resort

**Key Configuration:**
- **Maximum:** 1500 tokens per chunk (well under 8191 embedding limit)
- **Overlap:** 15% between chunks (preserves cross-reference context)
- **Validation:** Pre-validate all chunks before OpenAI API calls
- **Structure-Aware:** Respects legal hierarchy (title → chapter → part → section → subsection)

**Why 1500 tokens?**
- OpenAI text-embedding-3-large has 8191 token hard limit
- 1500 provides headroom for metadata in prompt engineering
- Empirically tested sweet spot for regulatory text density

**Why 15% overlap?**
- Preserves context for cross-references like "as defined in paragraph (a)"
- Prevents information loss at chunk boundaries
- Small enough to avoid significant storage bloat

---

### Federal (CFR)

**Source:** eCFR API (XML format)
**Official URL:** https://www.ecfr.gov/api/versioner/v1/
**Granularity:** Section-level (e.g., 21 CFR 117.5)

**Target Titles:**
- Title 7: Agriculture
- Title 9: Animals and Animal Products
- Title 21: Food and Drugs
- Title 27: Alcohol, Tobacco, Products and Firearms
- Title 29: Labor
- Title 40: Protection of Environment
- Title 49: Transportation

**Chunking Implementation:** `apps/workers/src/federal/chunk.ts`

**Strategy:**
1. Count tokens in full section
2. If ≤1500 tokens → return as single chunk
3. If >1500 tokens → detect subsections via regex:
   - Pattern: `(?:^|\n)\s*(\([a-z0-9]+\)(?:\([a-z0-9]+\))*)\s+`
   - Matches: (a), (b), (1), (2), (a)(1), (b)(2)(i), etc.
4. Split at subsection boundaries
5. For oversized subsections → split at paragraphs with 15% overlap

**Subsection Detection Examples:**
```
(a) General requirements.
(b) Specific requirements include:
  (1) Temperature controls
  (2) Record keeping
(c) Exceptions apply when...
```

**Paragraph Splitting:**
- Paragraphs detected via `\n\n+` (double newline) or `\n(?=\s{2,})` (newline before indentation)
- Overlap calculated by token count (not paragraph count)
- Aims for ~15% overlap, adjusting to paragraph boundaries

---

### State (Texas Statutes & TAC)

**Sources:**
- **Statutes:** capitol.texas.gov (HTML)
- **TAC:** sos.state.tx.us (HTML)

**Granularity:**
- Statutes: Section-level (e.g., Tex. Health & Safety Code § 431.002)
- TAC: Rule-level (e.g., 25 TAC § 229.163)

**Target Codes:**
- **27 Statute Codes:** Agriculture, Alcoholic Beverage, Business & Commerce, Health & Safety, Labor, Penal, Tax, and more
- **5 TAC Titles:** 16 (Economic Regulation), 22 (Social Services), 25 (Health Services), 30 (Environmental Quality), 37 (Public Safety)

**Chunking Implementation:** `apps/workers/src/texas/chunking.ts`

**Strategy:** Mirrors federal approach
1. Count tokens in full section/rule
2. If ≤1500 tokens → single chunk
3. If >1500 tokens → detect subsections:
   - Inline patterns: `(a)`, `(1)`, `(i)`
   - Line-start patterns: `^\s*\([a-z0-9]+\)`
   - Two-pass detection for flexibility across HTML variations
4. Split at subsection boundaries
5. For oversized subsections → paragraph split with 15% overlap

**Difference from Federal:**
- HTML parsing (Cheerio) instead of XML
- More flexible selector strategies due to inconsistent page structures
- Separate functions for statute vs TAC (different HTML patterns)

---

### County (Ordinances)

**Sources:**
- **9 counties:** library.municode.com (Municode platform)
- **1 county:** dallascounty-tx.elaws.us (eLaws platform)

**Target Counties (by FIPS):**
- 48201 (Harris), 48113 (Dallas), 48439 (Tarrant), 48029 (Bexar)
- 48453 (Travis), 48085 (Collin), 48121 (Denton), 48157 (Fort Bend)
- 48491 (Williamson), 48141 (El Paso)

**Granularity:** Section-level (e.g., Harris County Code § 1.02)

**Chunking Implementation:** `apps/workers/src/counties/chunking.ts`

**Strategy:**
1. Count tokens in full ordinance section
2. If ≤1500 tokens → single chunk
3. If >1500 tokens → detect subsections (less structured than federal/state)
4. **Fallback to paragraph splitting more often** - county ordinances have less consistent subsection formatting
5. Paragraph split with 15% overlap

**County-Specific Challenges:**
- HTML structure varies significantly across counties
- Multiple selector strategies needed (try primary, fallback to alternatives)
- Less formal subsection markers than federal regulations

**Adapter Pattern:**
- `CountyAdapter` interface abstracts platform differences
- `MunicodeAdapter`, `ElawsAdapter`, `AmlegalAdapter` implementations
- Factory function `getAdapterForCounty()` returns correct adapter per county

---

### Municipal (City Codes)

**Sources:**
- **17 cities:** Municode via Firecrawl (JavaScript-rendered)
- **3 cities:** American Legal via Firecrawl (JavaScript-rendered)

**Target Cities:**
Houston, San Antonio, Dallas, Austin, Fort Worth, El Paso, Arlington, Corpus Christi, Plano, Lubbock, Laredo, Irving, Garland, Frisco, McKinney, Amarillo, Grand Prairie, Brownsville, Pasadena, Mesquite

**Granularity:** Section-level (e.g., Houston Code of Ordinances § 1-2)

**Chunking Implementation:** `apps/workers/src/municipal/chunking.ts`

**Strategy:**
1. Parse Firecrawl markdown to ordinances using `marked` lexer
2. Detect chapters (H1-H2 headings) and sections (H2-H4 headings)
3. Extract subsections via two-pass detection:
   - **Pass 1:** Inline patterns `(a)`, `(1)`, `(i)` within paragraphs
   - **Pass 2:** Line-start patterns `^\s*\([a-z0-9]+\)`
4. Count tokens in full section
5. If ≤1500 tokens → single chunk
6. If >1500 tokens and has subsections → split at subsection boundaries
7. If >1500 tokens and no subsections → paragraph split with 15% overlap

**Municipal-Specific Challenges:**
- JavaScript-rendered content requires Firecrawl
- Markdown conversion introduces formatting variations
- Section numbering inconsistent across cities (1-2, 1.02, 1-02)
- Two-pass subsection detection handles both inline and line-start formats

**Markdown Cache:**
- Raw markdown cached in R2 for 30 days (default)
- Minimizes Firecrawl API credit usage
- Cache key: `municipal/{cityId}/raw/page.md`

---

## Metadata Schema (Pinecone)

All chunks stored in Pinecone include rich metadata for filtering and citation generation.

**Type Definition:** `ChunkMetadata` in `apps/workers/src/pinecone.ts`

| Field | Type | Required | Description | Example |
|-------|------|----------|-------------|---------|
| `chunkId` | string | Yes | Unique identifier for chunk | `cfr-21-117-5-0` |
| `sourceId` | string | Yes | Source document identifier | `cfr-title-21` |
| `sourceType` | enum | Yes | Regulatory source type | `federal` \| `state` \| `county` \| `municipal` |
| `jurisdiction` | string | Yes | Jurisdiction identifier | `US`, `TX`, `TX-48201`, `TX-houston` |
| `text` | string | Yes | Full chunk text content | Section text... |
| `citation` | string | Yes | Bluebook citation | `21 C.F.R. § 117.5` |
| `title` | string | No | Section title/heading | "Current Good Manufacturing Practice" |
| `chunkIndex` | number | Yes | Position in source (0-indexed) | `0` |
| `totalChunks` | number | Yes | Total chunks in source | `1` |
| `category` | string | No | Activity tag | `food-safety`, `building-codes` |
| `indexedAt` | string | Yes | ISO 8601 timestamp | `2026-02-03T12:00:00Z` |
| `lastUpdated` | string | No | Source last updated | `2025-12-01T00:00:00Z` |

### Jurisdiction Format

| Source Type | Format | Examples |
|-------------|--------|----------|
| Federal | `US` | `US` |
| State | `{STATE}` | `TX` |
| County | `{STATE}-{FIPS}` | `TX-48201` (Harris County) |
| Municipal | `{STATE}-{cityId}` | `TX-houston` |

**Why this format?**
- Enables hierarchical filtering (all Texas → specific county → specific city)
- FIPS codes are unique and stable (unlike county names)
- City IDs are URL-friendly slugs

### sourceType Enum

Values: `federal` | `state` | `county` | `municipal`

**Usage in Pinecone Filters:**
```typescript
// Query only federal regulations
filter: { sourceType: 'federal' }

// Query Texas state and county regulations
filter: {
  sourceType: { $in: ['state', 'county'] },
  jurisdiction: { $eq: 'TX' }
}
```

### Citation Format (Bluebook)

All citations follow legal Bluebook format for lawyer familiarity:

| Source | Format | Example |
|--------|--------|---------|
| CFR | `{title} C.F.R. § {section}` | `21 C.F.R. § 117.5` |
| Texas Statute | `Tex. {Code} Ann. § {section} (West {year})` | `Tex. Health & Safety Code Ann. § 431.002 (West 2023)` |
| TAC | `{title} Tex. Admin. Code § {section} ({year})` | `25 Tex. Admin. Code § 229.163 (2023)` |
| County | `{County} County, Tex., {Code} § {section} ({year})` | `Harris County, Tex., Code § 1.02 (2023)` |
| Municipal | `{City}, Tex., Code of Ordinances § {section} ({year})` | `Houston, Tex., Code of Ordinances § 1-2 (2023)` |

**Citation Generation:** See `apps/workers/src/lib/citations.ts` for implementation

---

## R2 Storage Structure

All regulatory documents cached in Cloudflare R2 before chunking/embedding.

**Bucket:** Configured via `R2_BUCKET` binding in `apps/workers/wrangler.jsonc`

### Folder Hierarchy

```
/
├── federal/
│   ├── cfr/
│   │   └── title-{N}/              # CFR title number (7, 9, 21, etc.)
│   │       └── part-{N}.xml        # Raw XML from eCFR
│   └── checkpoints/
│       └── cfr-title-{N}.json      # Pipeline checkpoint per title
│
├── texas/
│   ├── statutes/
│   │   └── {code}/                 # Code abbreviation (PE, HS, AL, etc.)
│   │       └── chapter-{N}/
│   │           └── {section}.html  # Raw HTML from capitol.texas.gov
│   ├── tac/
│   │   └── title-{N}/              # TAC title number (16, 22, 25, etc.)
│   │       └── chapter-{N}/
│   │           └── {section}.html  # Raw HTML from sos.state.tx.us
│   └── checkpoints/
│       ├── statute.json            # Statute pipeline checkpoint
│       └── tac.json                # TAC pipeline checkpoint
│
├── counties/
│   ├── {fipsCode}/                 # 5-digit FIPS code (48201, 48113, etc.)
│   │   └── chapter-{name}/         # Chapter name/number
│   │       └── {section}.html      # Raw HTML from Municode/eLaws
│   └── checkpoints/
│       └── county.json             # Single checkpoint for all counties
│
└── municipal/
    ├── {cityId}/                   # City slug (houston, austin, dallas)
    │   ├── chapter-{N}/
    │   │   └── {section}.json      # Parsed ordinance (not raw HTML)
    │   └── raw/
    │       └── page.md             # Raw markdown cache from Firecrawl
    └── checkpoints/
        └── municipal.json          # Single checkpoint for all cities
```

### Storage Patterns by Source

| Source | Raw Format | Parsed Format | Checkpoint Scope |
|--------|-----------|---------------|------------------|
| Federal | XML | Not stored (parsed on-demand) | Per title |
| Texas | HTML | Not stored (parsed on-demand) | Per source type |
| County | HTML | Not stored (parsed on-demand) | All counties |
| Municipal | Markdown | JSON ordinances | All cities |

**Why municipal stores parsed JSON?**
- Firecrawl costs money per scrape
- Markdown → JSON parsing is non-trivial (marked lexer)
- Enables re-chunking without re-scraping

### Checkpoint Format

Checkpoints enable pipeline resumption after failures or rate limiting.

**Example Checkpoint:**
```json
{
  "sourceType": "county",
  "lastProcessedCounty": "Harris",
  "lastProcessedSection": "1.05",
  "timestamp": "2026-02-03T12:30:00Z",
  "chunksProcessed": 150,
  "status": "in_progress"
}
```

**Checkpoint Strategy:**
- **Federal:** Per-title checkpoints (7 titles → 7 checkpoints)
- **Texas:** Per-source-type (statute.json, tac.json)
- **County:** Single checkpoint for all counties (sequential processing)
- **Municipal:** Single checkpoint for all cities (sequential processing)

---

## Embedding Pipeline

### Configuration

**Model:** OpenAI `text-embedding-3-large`
**Dimensions:** 3072
**Batch Size:** 64 chunks per API call (OpenAI recommended)
**Batch Delay:** 100ms between batches (rate limit prevention)
**Max Retries:** 4 attempts with exponential backoff
**Retry Delays:** 1s, 2s, 4s, 8s

**Implementation:** `apps/workers/src/federal/embed.ts`

### Token Validation

**Pre-validation required** - OpenAI rejects chunks >8191 tokens

**Validation Strategy:**
1. Validate each chunk before batching
2. Throw `EmbeddingError` with `TOKEN_LIMIT` code if any chunk >8191 tokens
3. Log chunk ID and token count for debugging

**Target vs Hard Limit:**
- **Target:** 1500 tokens (soft limit, aim for this)
- **Hard Limit:** 8191 tokens (OpenAI will reject)

**Why pre-validate?**
- OpenAI API returns 400 error for oversized chunks
- Wastes API credits and time
- Pre-validation fails fast with specific chunk ID

### Batch Processing

**Algorithm:**
```typescript
for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
  const batch = chunks.slice(i, i + BATCH_SIZE);  // 64 chunks
  const texts = batch.map(c => c.text);

  // Pre-validate batch
  validateAllChunks(texts);

  // Generate embeddings via OpenAI API
  const embeddings = await generateEmbeddings(texts, apiKey);

  // Combine chunks with embeddings
  results.push(...zip(batch, embeddings));

  // Delay before next batch
  if (hasMoreBatches) await sleep(BATCH_DELAY_MS);
}
```

**Progress Logging:**
- Log after each batch: `Embedding batch 3/10 (64 chunks, 450ms)`
- Emit progress events for UI updates (optional)

### Retry Logic (Exponential Backoff)

**Trigger:** HTTP 429 (Rate Limit) from OpenAI

**Backoff Schedule:**
1. Attempt 1: Immediate
2. Attempt 2: Wait 1s
3. Attempt 3: Wait 2s
4. Attempt 4: Wait 4s
5. Attempt 5: Wait 8s

**After max retries:** Throw `EmbeddingError` with `RATE_LIMIT` code

**Non-Retryable Errors:**
- Token limit exceeded (400) - throw immediately
- Authentication (401) - throw immediately
- Other API errors - throw after first attempt

---

## Pinecone Index

### Index Configuration

**Index Name:** `compliance-embeddings`
**Dimensions:** 3072 (matches text-embedding-3-large)
**Metric:** Cosine similarity
**Region:** AWS us-east-1
**Pod Type:** Serverless (cost-effective for MVP)

**Client Initialization:** `apps/workers/src/pinecone.ts`

### Upsert Batching

**Batch Size:** 100 vectors per upsert call (Pinecone recommended)

**Algorithm:**
```typescript
const UPSERT_BATCH_SIZE = 100;

for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
  const batch = vectors.slice(i, i + UPSERT_BATCH_SIZE);
  await index.upsert(batch);
}
```

**Vector Format:**
```typescript
{
  id: chunk.chunkId,          // "cfr-21-117-5-0"
  values: embedding,          // [0.123, -0.456, ...] (3072 floats)
  metadata: {
    chunkId: chunk.chunkId,
    sourceId: chunk.sourceId,
    sourceType: "federal",
    jurisdiction: "US",
    text: chunk.text,
    citation: "21 C.F.R. § 117.5",
    title: "Current Good Manufacturing Practice",
    chunkIndex: 0,
    totalChunks: 1,
    category: "food-safety",
    indexedAt: "2026-02-03T12:00:00Z",
    lastUpdated: "2025-12-01T00:00:00Z"
  }
}
```

**Why 100 vectors?**
- Pinecone API limit: 1000 vectors per request (we stay well under)
- Balances throughput with error recovery granularity
- Standard batch size across Pinecone examples

### Metadata Filtering

**Example Queries:**

```typescript
// Query only Texas regulations
await index.query({
  vector: queryEmbedding,
  topK: 10,
  filter: { jurisdiction: { $eq: 'TX' } }
});

// Query Harris County ordinances only
await index.query({
  vector: queryEmbedding,
  topK: 10,
  filter: {
    sourceType: 'county',
    jurisdiction: 'TX-48201'
  }
});

// Query food-safety regulations across all sources
await index.query({
  vector: queryEmbedding,
  topK: 10,
  filter: { category: 'food-safety' }
});

// Query federal and state regulations (exclude county/municipal)
await index.query({
  vector: queryEmbedding,
  topK: 10,
  filter: {
    sourceType: { $in: ['federal', 'state'] }
  }
});
```

**Metadata Indexing:**
- All metadata fields are indexed by default
- No additional configuration needed
- Filter performance scales with index size

---

## Data Freshness

### Convex Tracking

**Tables:**
- `jurisdictions` - Tracks scraped jurisdictions with lastScrapedAt timestamps
- Per-jurisdiction records: Federal titles, Texas codes, counties, cities

**Schema Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `jurisdictionId` | string | Unique ID (e.g., "federal-cfr-title-21") |
| `name` | string | Human-readable name |
| `type` | enum | `federal` \| `state` \| `county` \| `municipal` |
| `status` | enum | `pending` \| `active` \| `error` |
| `lastScrapedAt` | number | Unix timestamp (milliseconds) |
| `vectorCount` | number | Estimated vectors indexed |
| `error` | string | Error message if status=error |

**Indexes:**
- `by_jurisdiction_id` - Fast lookup by ID
- `by_county_fips` - County-specific queries
- `by_city_id` - City-specific queries

### Re-scraping Strategy

**Manual Trigger Only** - No automatic freshness detection

**Why manual?**
- No official change notification APIs available
- Polling HTML pages for changes is unreliable
- Regulatory changes are infrequent (monthly/quarterly)

**Recommended Schedule:**
- Federal CFR: Monthly (updated continuously by agencies)
- Texas Statutes: After legislative session (biennial)
- Texas TAC: Quarterly (agency rule changes)
- County/Municipal: Quarterly (or on-demand for known changes)

**HTTP Endpoints:**
```bash
# Re-scrape specific federal title
POST /pipeline/federal/:title

# Re-scrape all Texas statutes
POST /pipeline/texas/statutes

# Re-scrape specific county
POST /pipeline/counties/:countyName

# Re-scrape specific city
POST /pipeline/municipal/:cityId
```

**Convex Sync:**
- Pipeline updates `lastScrapedAt` after successful scraping
- Best-effort sync (pipeline success independent of Convex availability)
- If Convex unavailable, logs warning and continues

---

## Quality Metrics

### Validation Types (Phase 6)

**Implementation:** `apps/workers/src/validation/`

#### 1. TokenDistribution

**Purpose:** Ensure chunks fit embedding model efficiently

**Metrics:**
- `min` - Minimum tokens in any chunk
- `max` - Maximum tokens in any chunk
- `avg` - Average tokens per chunk
- `p50`, `p95`, `p99` - Percentiles

**Usage:**
```typescript
const dist = analyzeTokenDistribution(chunks);
console.log(`Avg: ${dist.avg} tokens, P95: ${dist.p95} tokens`);
```

**Target Ranges:**
- **Average:** 800-1200 tokens (sweet spot for density)
- **P95:** <1400 tokens (well under 1500 limit)
- **Max:** ≤1500 tokens (hard limit, enforced in chunking)

#### 2. MetadataCompleteness

**Purpose:** Ensure optional metadata fields populated when available

**Metrics:**
- `title_coverage` - % of chunks with title field
- `category_coverage` - % of chunks with category field
- `lastUpdated_coverage` - % of chunks with lastUpdated field

**Usage:**
```typescript
const completeness = checkMetadataCompleteness(chunks);
console.log(`Title coverage: ${completeness.title_coverage}%`);
```

**Targets:**
- **Title:** 100% for federal/state (always present), 80%+ for county/municipal
- **Category:** 100% for federal (mapped from TARGET_TITLES), 50%+ for others
- **LastUpdated:** 0% acceptable (sources don't expose this)

#### 3. CoverageReport

**Purpose:** Verify all expected sources indexed in Pinecone

**Metrics:**
- `expected` - Array of expected jurisdiction IDs
- `indexed` - Array of jurisdiction IDs found in Pinecone
- `missing` - Array of jurisdiction IDs not found

**Usage:**
```typescript
const report = await checkCoverage(index);
console.log(`Missing: ${report.missing.join(', ')}`);
```

**Expected Jurisdictions:**
- Federal: 7 titles (7, 9, 21, 27, 29, 40, 49)
- State: 1 jurisdiction (TX)
- County: 10 counties (by FIPS)
- Municipal: 20 cities (by cityId)
- **Total:** 38 jurisdictions

**Sampling Strategy:**
- Pinecone lacks `distinct()` operation for metadata fields
- Use dummy vector query with `topK=10000` per jurisdiction
- Extract unique jurisdiction values from results
- May need pagination for production (millions of vectors)

#### 4. DataQualityReport

**Purpose:** Aggregate quality metrics per jurisdiction

**Metrics:**
- Token distribution stats per jurisdiction
- Metadata completeness per jurisdiction
- Chunk counts per jurisdiction
- Errors/warnings per jurisdiction

**Usage:**
```typescript
const report = await generateDataQualityReport(index);
console.log(report.markdown); // Human-readable report
```

**Output Formats:**
- JSON: Machine-readable for monitoring
- Markdown: Human-readable for documentation

### Quality Targets

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| Citation Coverage | 100% | >99% |
| Avg Tokens/Chunk | 800-1200 | Any |
| P95 Tokens | <1400 | <1500 |
| Max Tokens | ≤1500 | ≤1500 |
| Title Coverage (Federal) | 100% | >95% |
| Chunk Count (Federal) | 5000-10000 | >1000 |
| Chunk Count (State) | 10000-20000 | >5000 |
| Chunk Count (County) | 500-2000/county | >100/county |
| Chunk Count (Municipal) | 1000-5000/city | >200/city |

**Monitoring:**
- Run quality validation after each pipeline execution
- Generate markdown reports in `.planning/quality/`
- Alert if critical thresholds violated

---

## Pipeline Orchestration

### End-to-End Flow

**Federal Pipeline:**
```
1. Fetch part XML from eCFR API
2. Store XML in R2 (federal/cfr/title-{N}/part-{N}.xml)
3. Parse XML to CFRPart structure
4. Chunk sections (chunkCFRPart)
5. Embed chunks (embedChunks)
6. Upsert to Pinecone with metadata
7. Update Convex jurisdiction status
8. Save checkpoint after each part
9. Clear checkpoint after title complete
```

**State Pipeline:**
```
1. Scrape statute/rule HTML from capitol.texas.gov or sos.state.tx.us
2. Store HTML in R2 (texas/statutes/{code}/... or texas/tac/title-{N}/...)
3. Parse HTML to TexasStatuteSection or TACRule
4. Chunk sections (chunkTexasStatute or chunkTACRule)
5. Embed chunks (reuse embedChunks)
6. Upsert to Pinecone with sourceType="state"
7. Update Convex jurisdiction status
8. Save checkpoint after each code/title
9. Clear checkpoint after all sources complete
```

**County Pipeline:**
```
1. Get adapter for county platform (Municode, eLaws, AmLegal)
2. Scrape ordinance HTML via adapter
3. Store HTML in R2 (counties/{fips}/chapter-{N}/...)
4. Parse HTML to CountyOrdinance
5. Chunk ordinances (chunkCountyOrdinance)
6. Embed chunks (reuse embedChunks)
7. Upsert to Pinecone with sourceType="county", jurisdiction="TX-{fips}"
8. Update Convex jurisdiction status
9. Save checkpoint after each county
10. Clear checkpoint after all counties complete
```

**Municipal Pipeline:**
```
1. Check markdown cache in R2 (municipal/{cityId}/raw/page.md)
2. If cache miss or expired → scrape via Firecrawl
3. Store markdown in R2 cache (30-day TTL)
4. Parse markdown to MunicipalOrdinance[] using marked lexer
5. Store parsed JSON in R2 (municipal/{cityId}/chapter-{N}/{section}.json)
6. Chunk ordinances (chunkMunicipalOrdinance)
7. Embed chunks (reuse embedChunks)
8. Upsert to Pinecone with sourceType="municipal", jurisdiction="TX-{cityId}"
9. Update Convex jurisdiction status
10. Save checkpoint after each city
11. Clear checkpoint after all cities complete
```

### HTTP Endpoints

**Federal:**
- `POST /pipeline/federal` - Process all 7 target titles
- `POST /pipeline/federal/:title` - Process single title

**State:**
- `POST /pipeline/texas/statutes` - Process all 27 statute codes
- `POST /pipeline/texas/tac` - Process all 5 TAC titles
- `POST /pipeline/texas` - Process both statutes and TAC

**County:**
- `POST /pipeline/counties` - Process all 10 enabled counties
- `POST /pipeline/counties/:county` - Process single county by name
- `GET /pipeline/counties/status` - Get enabled/skipped county status
- `POST /pipeline/counties/validate` - Validate all county sources

**Municipal:**
- `POST /pipeline/municipal` - Process all 20 enabled cities
- `POST /pipeline/municipal/:city` - Process single city by ID/name
- `GET /pipeline/municipal/status` - Get pipeline status and storage stats
- `POST /pipeline/municipal/reset` - Clear checkpoint for fresh run

**All endpoints return:**
- HTTP 200: Success with result JSON
- HTTP 207: Partial success (multi-status for batch operations)
- HTTP 500: Pipeline error with error details

---

## Error Handling

### Retry Strategies

**eCFR API (Federal):**
- Retry on: 429, 500, 502, 503, 504
- Exponential backoff: 1s, 2s, 4s, 8s (25% jitter)
- Max retries: 4

**Texas Scraping:**
- Retry on: 429, 500, 502, 503, 504
- Rate limit: 200ms between requests
- Exponential backoff: 1s, 2s, 4s, 8s (25% jitter)
- Respect Retry-After header
- Never retry 404 (NotFoundError)

**County Scraping:**
- Municode: 1000ms rate limit
- eLaws: 1000ms rate limit
- AmLegal: 5000ms rate limit (robots.txt compliance)
- Same retry strategy as Texas

**Municipal Scraping:**
- Firecrawl: 2000ms delay between cities
- No retries (Firecrawl SDK handles internally)
- Cache markdown to avoid redundant API calls

**OpenAI Embeddings:**
- Retry on: 429 only
- Exponential backoff: 1s, 2s, 4s, 8s
- Max retries: 4
- No retry on: 400 (token limit), 401 (auth)

**Pinecone Upsert:**
- No retries (Pinecone SDK handles internally)
- Graceful degradation if upsert fails

### Checkpoint Recovery

**On pipeline failure:**
1. Load checkpoint from R2
2. Skip already-processed sources
3. Resume from last processed source
4. Continue until complete or next failure

**Checkpoint granularity:**
- Federal: Per-part (enables resume mid-title)
- State: Per-code/title (skip completed codes)
- County: Per-county (skip completed counties)
- Municipal: Per-city (skip completed cities)

**Manual reset:**
```bash
# Clear federal checkpoint
POST /pipeline/federal/reset/:title

# Clear county checkpoint
POST /pipeline/counties/reset

# Clear municipal checkpoint
POST /pipeline/municipal/reset
```

---

## Performance Benchmarks

**Federal Pipeline (Title 21, ~150 parts):**
- Fetch: ~5 minutes
- Chunk: ~30 seconds
- Embed: ~10 minutes (64-chunk batches)
- Upsert: ~2 minutes
- **Total:** ~17 minutes

**State Pipeline (27 codes, ~5000 sections):**
- Scrape: ~30 minutes (200ms rate limit)
- Chunk: ~2 minutes
- Embed: ~30 minutes
- Upsert: ~5 minutes
- **Total:** ~67 minutes

**County Pipeline (10 counties, ~500 sections/county):**
- Scrape: ~60 minutes (1000ms rate limit)
- Chunk: ~2 minutes
- Embed: ~30 minutes
- Upsert: ~5 minutes
- **Total:** ~97 minutes

**Municipal Pipeline (20 cities, ~2000 sections/city):**
- Scrape: ~40 minutes (2000ms Firecrawl delay, cached after first run)
- Parse: ~5 minutes
- Chunk: ~5 minutes
- Embed: ~60 minutes
- Upsert: ~10 minutes
- **Total:** ~120 minutes (first run), ~80 minutes (cached markdown)

**Full Pipeline (all sources):**
- **Total Time:** ~5 hours (first run), ~4 hours (with caching)
- **Total Chunks:** ~50,000 chunks
- **Total Vectors:** ~50,000 vectors in Pinecone
- **R2 Storage:** ~500 MB raw documents

---

## Future Enhancements

### Planned Improvements

1. **Incremental Updates**
   - Track source document checksums/ETags
   - Only re-scrape changed documents
   - Delta updates to Pinecone (delete old chunks, insert new)

2. **Parallel Processing**
   - Process multiple titles/codes/counties in parallel
   - Worker pool pattern for scraping
   - Batch embedding requests across sources

3. **Additional Sources**
   - Other federal sources: FDA guidance documents, OSHA directives
   - Other states: California, New York, Florida
   - Federal court decisions (case law)

4. **Quality Improvements**
   - Machine learning for subsection detection
   - Smarter chunk boundary detection (semantic similarity)
   - Citation extraction for cross-references

5. **Monitoring**
   - Real-time pipeline dashboards
   - Alert on quality threshold violations
   - Cost tracking per source type

---

## Related Documentation

- **Project Overview:** `.planning/PROJECT.md`
- **Phase 6 Plans:** `.planning/phases/06-data-processing/`
- **Type Definitions:** `apps/workers/src/*/types.ts`
- **Chunking Implementation:** `apps/workers/src/*/chunk*.ts`
- **Storage Implementation:** `apps/workers/src/*/storage.ts`
- **Embedding Pipeline:** `apps/workers/src/federal/embed.ts`
- **Pinecone Client:** `apps/workers/src/pinecone.ts`

---

**Document Version:** 1.0
**Author:** ComplianceIQ Engineering
**Last Review:** 2026-02-03
