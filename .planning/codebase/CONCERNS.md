# Codebase Concerns

**Analysis Date:** 2026-01-31
**Last Updated:** 2026-01-31

## Tech Debt

**Data Source Fragmentation:**
- Issue: Data sources use inconsistent HTML structures, citation formats, and authentication methods across federal, state, county, and municipal levels. No unified schema exists. Each source (Municode, American Legal, Capitol.texas.gov, TAC SOS) requires custom scraping logic with manual citation normalization.
- Files: `doc_planning/costco-compliance-data-sources.md` (sections 3-4)
- Impact: Maintenance burden will grow linearly with new jurisdictions. Citation linking fragile. Difficult to scale beyond Texas pilot. Every new city/county requires new scraper implementation.
- Fix approach: Build citation normalizer module (`packages/shared/citations.ts`) early. Establish standard metadata schema for all chunks before scraping production data. Create scraper factories to reduce duplication. Document expected HTML patterns per source type.

**~~Browserless.io Dependency for Rendering~~ (RESOLVED):**
- Issue: ~~Municode and American Legal sites require JavaScript rendering.~~ **Resolved by switching to Firecrawl.**
- Solution: Firecrawl handles JS rendering and returns clean Markdown directly. Lower cost ($16/mo vs $50-100/mo), simpler integration, and purpose-built for LLM/RAG workflows.
- Remaining risk: Still depends on external service (Firecrawl). If Firecrawl is down, ingestion stops.
- Mitigation: Firecrawl has good uptime and the free tier (500 pages/mo) can be used for testing. Consider caching scraped pages in R2 with TTL to reduce API calls.

**MVP vs P1 Data Source Boundaries Unclear:**
- Issue: Documentation marks Federal Register, LegiScan, Congress.gov, and Texas Register as "P1 - change tracking" but actual implementation dependencies are not enforced. Developers could accidentally import P1 APIs into MVP code.
- Files: `costco-compliance-data-sources.md` (sections 1.2-1.4, 2.3-2.4)
- Impact: Scope creep during Phase 1. Accidentally building change-tracking features in MVP when MVP only needs current law. Could delay launch.
- Fix approach: Add environment variable guards in Cloudflare Workers (`ENABLE_CHANGE_TRACKING` flag). Document which API keys are required for MVP (only: eCFR, Mapbox). Separate P1 worker scripts into `/workers/future-*` directories.

---

## Known Bugs

**Pinecone Metadata Filtering May Not Filter Correctly:**
- Symptoms: Searches across jurisdictions may return chunks from wrong jurisdiction if metadata filtering is not applied correctly. Users in Houston might get Dallas regulations.
- Files: `costco-compliance-technical-architecture.md` (lines 677-721, section on Pinecone Configuration)
- Trigger: Query with address geocoding that matches multiple jurisdiction IDs. Search without explicit jurisdiction_id filter in metadata.
- Workaround: Always include jurisdiction_id in query filters. Implement pre-search jurisdiction validation in `convex/actions/query.ts`.

**Citation Format Normalization Not Defined:**
- Symptoms: Same law cited differently across sources. "Tex. Alco. Bev. Code § 22.01" vs "Texas Alcoholic Beverage Code Section 22.01" vs "AL.22.01" creates duplicate chunks or breaks deduplication.
- Files: `costco-compliance-data-sources.md` (line 935)
- Trigger: Any query across multiple source types with same underlying statute.
- Workaround: Manually curate citation normalizer. Build regex patterns per source type. Add `citation_normalized` field to Pinecone metadata.

---

## Security Considerations

**API Key Exposure in Cloudflare Workers:**
- Risk: API keys (OpenAI, Pinecone, LegiScan, Browserless, Mapbox) are stored in Cloudflare environment variables. Workers source code is deployed to Cloudflare (less controlled than traditional servers). If worker code is accidentally logged or intercepted, keys could be exposed.
- Files: `costco-compliance-technical-architecture.md` (lines 758-800, Environment Configuration section)
- Current mitigation: Cloudflare provides secure environment variable storage; keys not embedded in code. Worker code is not publicly readable.
- Recommendations: Implement secrets rotation policy. Use Cloudflare's native secrets vault rather than plaintext environment variables. Audit worker logs for API key leakage. Implement API key scoping per service (e.g., Mapbox key restricted to geocoding only).

**External REST API Authentication (P2 Feature):**
- Risk: Cloudflare Workers REST API (`external-api/`) will use API key authentication. If API key is leaked or brute-forced, external consumers could access full compliance data.
- Files: `costco-compliance-technical-architecture.md` (lines 58-59, line 486)
- Current mitigation: None — authentication not yet implemented in MVP.
- Recommendations: Before P2, implement rate limiting per API key. Consider OAuth2 or JWT bearer tokens instead of simple API key. Add audit logging for all external API requests. Implement IP whitelisting for Costco internal tools.

**Convex Auth Dependency on Clerk:**
- Risk: All user authentication depends on Clerk. If Clerk service is compromised or outage occurs, users cannot access the application.
- Files: `costco-compliance-technical-architecture.md` (lines 530-531)
- Current mitigation: Clerk is established provider with SOC 2 compliance.
- Recommendations: Document Clerk dependency. Plan fallback auth mechanism. Ensure Clerk is SOC 2 Type II certified before production. Review Clerk's data handling (user data stored in Clerk, not Convex).

**Regulatory Data Tampering Risk:**
- Risk: If Pinecone is compromised, compliance data could be silently corrupted. Users would receive incorrect legal guidance without knowing.
- Files: `costco-compliance-technical-architecture.md` (lines 141-152)
- Current mitigation: Pinecone is managed service with encryption at rest.
- Recommendations: Implement content hash verification for all indexed chunks (`content_hash` field in metadata). Audit Pinecone access logs monthly. Never allow direct write access from frontend — all updates through Cloudflare sync worker only.

---

## Performance Bottlenecks

**Sequential LLM Calls in Query Action:**
- Problem: Current `query.execute` action calls LLM after geocoding, searching, and ranking. Each step is sequential. Response time = geocoding + search + rerank + LLM + streaming = potentially 30+ seconds.
- Files: `costco-compliance-technical-architecture.md` (lines 388-469, `query.execute` action)
- Cause: Single-threaded action execution. Geocoding is required to know jurisdiction before search; search must complete before reranking; reranking before LLM. No parallelization possible.
- **Phase 1 Impact:** Low — testing via curl/API, latency less critical for validation.
- **Phase 2 Impact:** High — real users expect fast responses.
- Improvement path (defer to Phase 2): Pre-cache jurisdiction geocoding results in Convex. Implement streaming response from LLM. Add caching layer (Cloudflare KV) for repeated queries.

**~~Browserless.io Rendering Bottleneck for Scraping~~ (MITIGATED):**
- Problem: ~~Scraping 20 city ordinances sequentially could take hours.~~ **Mitigated by switching to Firecrawl.**
- Firecrawl improvement: Faster response times, no headless browser overhead. Returns Markdown directly — eliminates HTML parsing bottleneck.
- Remaining concern: Still need to respect rate limits. Firecrawl Starter tier allows 3,000 pages/mo.
- Improvement path: Implement queue batching, cache scraped Markdown in R2 with TTL (weekly refresh sufficient for most regulations), prioritize sources by change frequency.

**Embedding Generation Bottleneck at Scale:**
- Problem: MVP targets 33 sources with thousands of chunks total. OpenAI embeddings API rate limit is 500K requests per minute. If chunks are large or numerous, embedding queue could back up.
- Files: `costco-compliance-data-sources.md` (line 937), `costco-compliance-technical-architecture.md` (lines 421-426)
- Cause: Sequential embedding generation. No batch processing documented.
- Improvement path: Use OpenAI's batch API for embeddings if available. Split large documents into smaller chunks (target 512 tokens). Implement exponential backoff on rate limit errors. Cache embeddings by content hash to avoid re-embedding unchanged text.

**Pinecone Upsert Scalability:**
- Problem: Upserting thousands of chunks into Pinecone in single operation could timeout or fail.
- Files: `costco-compliance-technical-architecture.md` (lines 619-625)
- Cause: No batching strategy documented for Pinecone upserts.
- Improvement path: Batch upserts in groups of 100-500 chunks. Implement retry logic with exponential backoff. Track upsert status in R2 logs for resumability. Monitor Pinecone query latency — if rising, implement deletion of low-relevance old chunks.

---

## Fragile Areas

**Texas Statutes Scraper (Relies on Capitol.texas.gov Static HTML Structure):**
- Files: `costco-compliance-data-sources.md` (section 2.1)
- Why fragile: Capitol.texas.gov publishes HTML without API. If they change URL structure or HTML classes, scraper breaks silently. No monitoring for structure changes.
- Safe modification: Add HTML structure tests. Parse a few sample chapters, assert on expected structure. Run tests as part of ingestion pipeline. Log warnings if HTML parsing fails for any statute code.
- Test coverage: No tests currently planned. Need integration tests that actually fetch and parse real Texas statute pages.

**TAC (Texas Admin Code) SOS Portal:**
- Files: `costco-compliance-data-sources.md` (section 2.2)
- Why fragile: SOS site uses ASP.NET with ViewState. Site is known to be hard to scrape. New Appian portal is less understood. No fallback documented.
- Safe modification: Use Cornell LII as primary source instead of SOS portal (cleaner HTML). Test Cornell LII parsing thoroughly. Add fallback to print PDF versions if web scraping fails.
- Test coverage: Scraper tests needed for both SOS and Cornell alternatives.

**Citation Parsing and Linking:**
- Files: `costco-compliance-technical-architecture.md` (lines 447-448), functions not yet implemented
- Why fragile: `parseComplianceResponse(response)` function must extract citations from unstructured LLM output. Citation formats vary by source. If LLM output format changes, parsing breaks.
- Safe modification: Use structured output from Claude (JSON mode) to enforce citation format. Pre-define citation schema in prompt. Test with diverse query types.
- Test coverage: Need unit tests for citation extraction with mocked LLM responses.

**Jurisdiction Geocoding and Matching:**
- Files: `costco-compliance-technical-architecture.md` (lines 410-419)
- Why fragile: `geocodeAndResolve()` function must handle edge cases: same address in multiple counties, address on county boundary, address not found.
- Safe modification: Add jurisdiction boundary validation. When Mapbox returns multiple possible jurisdictions, query Pinecone for both and return results with jurisdiction tag. Test with boundary addresses.
- Test coverage: Need integration tests with real Mapbox API or mock.

---

## Scaling Limits

**Pinecone Storage and Query Latency with Growth:**
- Current capacity: Texas pilot = ~33 sources. Estimated 50K-100K chunks. Pinecone starter tier supports up to 1M vectors. At 100K chunks with 3072-dim embeddings, still well within limits.
- Limit: Once scaled to multiple states (10+ states) or entire US (50 states), vector database could exceed 10M chunks. Query latency may degrade from <1s to 5-10s.
- Scaling path: Monitor Pinecone query latency (set 1s SLA). Once latency exceeds SLA, upgrade to Standard tier. Implement chunk pruning — delete old chunks for superseded regulations. Consider multi-index sharding by jurisdiction level (federal, state, county, municipal indices).

**Convex Database Growth:**
- Current capacity: MVP assumes ~100-1000 users, ~10K conversations, ~100K messages. Convex free tier = 1M documents, unlimited queries. Easily sufficient for pilot.
- Limit: If Costco scales to 100+ locations with 100 users each, 1M messages per year is very possible. Reaches Convex free tier limits.
- Scaling path: Upgrade to Convex Pro ($25/mo). Archive old conversations (move to cold storage). Implement conversation pagination (load older messages on demand, not all at once).

**Cloudflare Workers Concurrency Limits:**
- Current capacity: Cloudflare Workers free tier: 100,000 requests per day. MVP ingestion (weekly re-scrape) + query workload (500 queries/day) = easily within limits.
- Limit: If 10+ concurrent scraping jobs run simultaneously, or if query volume exceeds 10K requests/day, could hit rate limits.
- Scaling path: Subscribe to Cloudflare Paid plan. Implement queue batching. Stagger scraping jobs across multiple workers.

**R2 Storage Growth:**
- Current capacity: MVP sources = 33. Assuming 100-500 MB raw HTML/text per source = 5-15 GB total raw storage. R2 free tier = 10 GB. Just fits.
- Limit: Adding all 50 US states could exceed 100+ GB. R2 charges $0.015/GB after free tier.
- Scaling path: Implement compression for raw R2 files (gzip). Archive old versions. Implement cleanup job for intermediate processing files.

**External Service Costs:**
- Current estimate (MVP): $1,650-2,300/month (dominated by Claude LLM at ~$1,500/mo)
- Scaling limit: If usage grows 10x (5,000 queries/day instead of 500), Claude costs scale to $15K/mo. Not sustainable for early-stage product.
- Scaling path: Implement caching for common queries (Convex cache + Cloudflare KV). Use cheaper embedding models where possible. Batch LLM requests to reduce API calls. Consider on-premise LLM deployment.

---

## Dependencies at Risk

**Anthropic Claude API:**
- Risk: Entire query response generation depends on Claude. Price is high ($0.003 per 1K input tokens). If Anthropic raises prices, product economics break. If Claude service is unavailable, users get no answers.
- Impact: Core product experience completely blocked without LLM.
- Migration plan: Document interfaces for LLM swapping (`convex/actions/claude.ts`). Keep LLM calls in separate action module. Test with alternative LLM (GPT-4, Gemini). Have fallback to simple keyword search (no LLM synthesis) for outages.

**OpenAI Embeddings API:**
- Risk: Vector database indexes depend on embeddings. If OpenAI API unavailable or deprecated, re-embedding entire corpus is expensive (~$13/month but takes time).
- Impact: Can't update search index. Existing search works, but new documents can't be added.
- Migration plan: Implement embedding model abstraction. Test with open-source embedding models (SentenceTransformers). Pre-generate and cache embeddings for all MVP sources to reduce dependency on embedding API at query time.

**Mapbox Geocoding API:**
- Risk: Address resolution depends on Mapbox. Free tier = 100K requests/month. If usage exceeds, requires paid plan ($0.50/1000 requests).
- Impact: Jurisdiction resolution fails. Users can't get location-specific compliance guidance.
- Migration plan: Implement caching for geocoding results in Convex. Use USPS/Google Maps as fallback. Document Mapbox rate limits. Batch geocoding requests where possible.

**Clerk Authentication:**
- Risk: Complete auth provider dependency. If Clerk has outage, no one can login.
- Impact: Application completely unusable during outage.
- Migration plan: Plan for Clerk alternative (Auth0, firebase). Document auth abstraction layer. Keep auth logic separate from business logic.

**Pinecone Vector Database:**
- Risk: Complete knowledge base dependency. If Pinecone is compromised or outage occurs, users get no search results.
- Impact: Application degrades to non-functional (no compliance data search).
- Migration plan: Regular Pinecone backups to R2 (export vectors + metadata monthly). Implement fallback to simple text search in R2 if Pinecone unavailable.

---

## Missing Critical Features

**Change Tracking and Alerts:**
- Problem: MVP only answers "what's the law now?" Does not answer "what changed?" or alert users when regulations change. This is deferred to P1 but is critical for compliance use case.
- Blocks: Costco operations team needs alerts for relevant rule changes. Without alerts, users must manually re-check regulations periodically.
- Risk: Users may rely on stale data without knowing. Compliance violations could result from missed changes.

**Confidence Scoring and Source Attribution:**
- Problem: LLM can hallucinate or misinterpret regulations. MVP design includes `confidence` field (lines 221) but no method to calculate it.
- Blocks: Users can't distinguish high-confidence answers from uncertain ones.
- Risk: Incorrect confidence scores could mislead users into wrong compliance decisions.

**Conversation Context and Multi-Turn Reasoning:**
- Problem: MVP design mentions conversation history (line 435) but no mechanism to track conversation context across turns or ask follow-up questions reliably.
- Blocks: Users can't iteratively refine queries or ask "what about [variation]?"
- Risk: Simple one-turn Q&A limits usefulness for complex multi-jurisdiction scenarios.

**Audit Trail and Compliance Reporting:**
- Problem: No mechanism to export compliance checklist or audit trail. Costco legal team needs documentation of what was checked and when.
- Blocks: Costco can't use ComplianceIQ as source of truth for regulatory filings.
- Risk: Liability if ComplianceIQ is used to justify compliance decisions but no record exists.

---

## Test Coverage Gaps

**Data Pipeline Ingestion:**
- What's not tested: Scraper logic for each source type (Texas Statutes, TAC, Municode, American Legal). Chunk generation. Embedding generation. Pinecone upsert. R2 storage.
- Files: `workers/ingestion-api/src/sources/*`, `workers/ingestion-scraper/src/scrapers/*`, `workers/embedding/src/*`
- Risk: Silent failures in data pipeline. Incomplete chunks, malformed metadata, duplicates in Pinecone. Users don't get comprehensive search results.
- Priority: High — ingestion is foundation of entire system.

**RAG Query Pipeline:**
- What's not tested: Geocoding accuracy. Jurisdiction resolution. Pinecone search quality. Reranking logic. LLM prompt construction. Citation extraction. Message streaming.
- Files: `convex/actions/query.ts`, `convex/lib/citations.ts`, `convex/actions/pinecone.ts`
- Risk: Incorrect answers, wrong jurisdictions, broken citations, streaming errors.
- Priority: High — this is core user-facing feature.

**Error Handling and Fallbacks:**
- What's not tested: API failures (Mapbox down, Pinecone down, Claude down, Browserless down). Timeout handling. Retry logic. Graceful degradation.
- Files: `convex/actions/query.ts` (lines 461-467 show basic error handling but no tests)
- Risk: Users get cryptic error messages. No graceful fallback to simpler functionality.
- Priority: Medium — needed before Costco pilot.

**Frontend Component Interactions (Phase 2):**
- What's not tested: Chat interface streaming updates. Real-time message status changes. Citation rendering. Conversation list updates.
- Files: `apps/web/src/components/chat/*`, `apps/web/src/components/MessageList.tsx`
- Risk: UI doesn't update correctly.
- Priority: **Deferred to Phase 2** — not needed for backend-first MVP.

**Convex Mutations and Queries:**
- What's not tested: Concurrent message sends (race conditions). Conversation archive/delete. Message status transitions. Feedback submission.
- Files: `apps/convex/functions/*`
- Risk: Data consistency issues. Conversations lost. Messages corrupted.
- Priority: Medium — data integrity critical for production.

---

## Architectural Risks

**Monorepo Complexity with Multiple Deployment Targets:**
- Risk: Single monorepo with apps/, workers/, packages/. Three independent deployment pipelines (Convex, Cloudflare, Vercel). Dependency management between packages could create coupling issues.
- Files: `codebase-structure-options.md` (Option 1 recommended structure)
- Mitigation: Use pnpm workspaces and Turborepo for clarity. Define clear dependency graph (workers can't depend on apps/convex, only on packages/). Test deployments independently in CI/CD.

**Data Pipeline Decoupling from Application:**
- Risk: Cloudflare Workers (data pipeline) is separate from Convex (application). If metadata sync fails, Convex doesn't know what sources are fresh. If chunks are indexed but metadata not synced, search works but freshness info is missing.
- Files: `costco-compliance-technical-architecture.md` (lines 650-673, sync worker)
- Mitigation: Implement idempotent sync operations. Add health check queries (compare Convex source table vs Pinecone latest timestamp). Implement retry with exponential backoff in sync worker.

**Real-Time Message Streaming Architecture:**
- Risk: MVP assumes message streaming works by action updating message status multiple times. No actual implementation of streaming protocol shown.
- Files: `costco-compliance-technical-architecture.md` (lines 228, status transitions)
- Mitigation: Clarify whether using Convex subscriptions or polling. Implement prototype. Test latency of status updates.

---

*Concerns audit: 2026-01-31*
*Updated: 2026-01-31 — Browserless.io concerns resolved (Firecrawl), Phase 1/2 priority split*
