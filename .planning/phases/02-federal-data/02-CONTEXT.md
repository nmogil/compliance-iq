# Phase 2: Federal Data - Context

**Gathered:** 2026-02-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the federal data ingestion pipeline: fetch regulations from eCFR API, store raw content in R2, chunk with metadata, embed via OpenAI, and index in Pinecone for vector search. Data source is eCFR API only (no scraping).

</domain>

<decisions>
## Implementation Decisions

### Data Source
- eCFR API for all federal regulations
- CFR Titles to index: 7, 9, 21, 27, 29, 40, 49
  - Title 7: Agriculture (food retail, produce, meat grading)
  - Title 9: Animals & Animal Products (meat/poultry inspection)
  - Title 21: Food & Drugs (FDA, pharmacy, food safety)
  - Title 27: Alcohol, Tobacco, Firearms (alcohol licensing)
  - Title 29: Labor (employment, OSHA)
  - Title 40: Environment (fuel storage, hazmat)
  - Title 49: Transportation (fuel transport)

### Chunking Strategy
- Section-level granularity (each CFR section becomes one or more chunks)
- Full Bluebook-style citations: "21 C.F.R. § 111.3(a)"
- Direct URL to eCFR.gov source for every chunk
- Claude's discretion: How to split long sections (>2000 tokens)

### Metadata Schema
- Jurisdiction identifiers: Both FIPS codes AND human-readable names
- Dates: Capture effective date and last amended date from eCFR
- Claude's discretion: Activity tagging approach (manual mapping vs LLM classification)
- Claude's discretion: Hierarchy depth (title/chapter/part/section)

### Data Flow Architecture
- **R2**: Raw regulation text (audit trail, reprocessing)
- **Pinecone**: Vectors + metadata (chunk text, citations, jurisdiction filters)
- **Convex**: Minimal sources table for freshness only (source_id, jurisdiction, last_updated, status)
- **Cloudflare**: Pipeline logs stay native in Cloudflare dashboard

### Pipeline Execution
- Manual triggering for MVP (no scheduled cron)
- Convex sources table: Minimal freshness tracking only (not stats/counts)
- Claude's discretion: Update strategy (full refresh vs incremental)
- Claude's discretion: Error handling approach

### Claude's Discretion
- Splitting strategy for long sections
- Activity tagging methodology
- Metadata hierarchy depth
- Pipeline update strategy (full vs incremental)
- Error handling and retry logic
- Freshness tracking implementation details

</decisions>

<specifics>
## Specific Ideas

- Lawyers expect Bluebook citations — standard legal format is non-negotiable
- Every chunk must link back to official eCFR.gov for verification
- Keep Convex focused on real-time user data; don't bloat with pipeline logs

</specifics>

<deferred>
## Deferred Ideas

- **Firecrawl for scraping**: Use Firecrawl (not Browserless) for any scraping needs in Phases 3-5 (Texas statutes, counties, municipalities). Not needed for Phase 2 since eCFR has an API.
- **Scheduled pipeline runs**: Add cron triggers after MVP is stable
- **Detailed pipeline stats in Convex**: Keep minimal for now, expand if needed

</deferred>

---

*Phase: 02-federal-data*
*Context gathered: 2026-02-01*
