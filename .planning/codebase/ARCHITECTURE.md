# Architecture

**Analysis Date:** 2026-01-31
**Last Updated:** 2026-01-31

## Pattern Overview

**Overall:** Backend-first architecture with decoupled application and data pipeline layers

**Key Characteristics:**
- Data pipeline first — frontend deferred until backend validated
- Asynchronous batch data pipeline (Cloudflare Workers)
- Vector search for regulatory information retrieval (Pinecone)
- Real-time application layer (Convex) for query orchestration
- External REST API layer (Hono on Cloudflare Workers) for testing and third-party access
- Firecrawl for JS-rendered page scraping (replaces Browserless.io)

## MVP Scope (Backend-First)

**Phase 1 (Current):** Data pipeline + API only
- Ingest federal regulations (eCFR)
- Ingest Texas state statutes and admin code
- Ingest top 10 Texas city/county ordinances
- Chunk, embed, and index in Pinecone
- Expose query endpoint via Convex HTTP actions
- Test via curl/Postman — no frontend required

**Phase 2 (Later):** Frontend
- React chat interface
- Real-time message streaming
- Citation rendering
- User authentication (Clerk)

## Layers

**Data Pipeline Layer (Cloudflare Workers) — PRIMARY FOCUS:**
- Purpose: Scheduled scraping, document ingestion, chunking, embedding, indexing
- Location: `workers/`
- Contains: API ingesters, Firecrawl scrapers, embedding processors, queue consumers
- Depends on: Cloudflare R2 (object storage), Cloudflare Queues (message passing), Pinecone (vector storage), Firecrawl (JS rendering), external APIs (eCFR, Federal Register)
- Used by: Scheduled cron triggers, upstream workers

**Application Layer (Convex):**
- Purpose: Query orchestration, LLM coordination, conversation state (when frontend added)
- Location: `apps/convex/`
- Contains: Queries, mutations, actions, HTTP endpoints, database schema
- Depends on: Pinecone (vector search), Anthropic Claude (LLM), Mapbox (geocoding), OpenAI (embeddings)
- Used by: HTTP API calls (Phase 1), React frontend (Phase 2), Cloudflare Workers for syncing

**Client Layer (Phase 2 — Deferred):**
- Purpose: User interface for compliance queries and chat
- Location: `apps/web/src/`
- Contains: React components, hooks, UI state management
- Depends on: Convex SDK, Clerk auth
- Used by: End users (Costco compliance team)

**Vector Database (Pinecone):**
- Purpose: Store embeddings of regulatory text with metadata filtering
- Location: External service
- Contains: 3072-dimensional text embeddings, metadata-indexed chunks
- Depends on: Cloudflare Workers for writes, Convex actions for reads
- Used by: RAG pipeline for regulatory information retrieval

## Data Flow

**Query Execution Flow:**

1. User submits compliance question in React UI
2. Frontend calls `messages.send` mutation via Convex SDK
3. Mutation creates user message record and schedules `query.execute` action
4. Action geocodes address (Mapbox) to resolve jurisdictions if location-specific
5. Action generates embedding of query (OpenAI)
6. Action searches Pinecone with embedding and metadata filters (jurisdiction, source type)
7. Action reranks top 20 results
8. Action builds Claude prompt with top 10 regulatory chunks + conversation history
9. Action calls Claude API with streaming
10. Action parses response for citations and permits
11. Action writes complete message with citations and confidence score to Convex
12. React components subscribe to message updates via `useQuery`, rendering in real-time

**Data Ingestion Flow:**

1. Scheduled Cloudflare Worker trigger (weekly MVP, daily P1)
2. Worker identifies sources to scrape (eCFR, state statutes, local ordinances)
3. Worker uses API ingester (federal) or Firecrawl (state/local HTML/JS sites)
4. Firecrawl returns clean Markdown — already LLM-ready, minimal parsing needed
5. Raw documents stored in Cloudflare R2 with metadata
6. Worker enqueues document to `ingest-queue`
7. Ingestion queue consumer chunks Markdown text (500 token overlap)
8. Chunks enqueued to `embedding-queue`
9. Embedding queue consumer generates OpenAI embeddings (3072-dim)
10. Embeddings enqueued to `index-queue`
11. Index queue consumer upserts to Pinecone with full metadata
12. Sync worker updates Convex `sources` and `jurisdictions` tables with freshness info

**State Management:**

- User/conversation state: Convex database (persistent across sessions)
- Message streaming state: Convex `messages` table status field (pending → processing → streaming → complete)
- Chat UI state: React component local state (input box, scroll position)
- Vector embeddings: Pinecone (read-only from Convex, written by Workers)
- Regulatory metadata: Convex `sources` and `jurisdictions` tables (synced from Workers)
- Temporary processing state: Convex scheduler (internal actions)

## Key Abstractions

**Jurisdiction Abstraction:**
- Purpose: Represents regulatory boundaries (federal, state, county, municipal)
- Examples: `tx-state`, `tx-harris`, `tx-houston`, `federal`
- Pattern: Hierarchical with parent relationships (counties belong to states)
- Stored in: Convex `jurisdictions` table, Pinecone metadata `jurisdiction_id`
- Usage: Filters on all regulatory queries

**Source Abstraction:**
- Purpose: Represents a collection of regulatory documents (statute, regulation, ordinance, guidance)
- Examples: Texas Alcoholic Beverage Code, Harris County Ordinances, Houston Municipal Code
- Pattern: Belongs to jurisdiction, tracks ingestion freshness, chunk count
- Stored in: Convex `sources` table, Pinecone metadata `source_id`, `source_type`, `citation`
- Usage: Metadata filtering in vector search, citation generation

**Chunk Abstraction:**
- Purpose: Embeddings of regulatory text segments with rich metadata
- Examples: Specific statute sections, regulatory paragraphs, ordinance articles
- Pattern: Fixed token size with overlap (500 tokens), preserves hierarchy (chapter, section)
- Stored in: Pinecone vectors with metadata
- Metadata includes: `jurisdiction_id`, `source_id`, `citation`, `section_title`, `activity_tags`, `effective_date`
- Usage: Basis of vector search and RAG context

**Citation Abstraction:**
- Purpose: Normalized reference to specific regulatory text
- Examples: "Tex. Alco. Bev. Code § 22.01", "Harris County Code § 32.1"
- Pattern: Extracted from Claude response, linked to Pinecone chunks
- Stored in: Message `citations` array with source URL and text excerpt
- Usage: Provides traceability and allows users to verify compliance guidance

**Activity Tag Abstraction:**
- Purpose: Business activity classification system
- Examples: `alcohol_retail`, `alcohol_spirits`, `licensing`, `permitting`
- Pattern: Applied to chunks during indexing, used as metadata filter in searches
- Stored in: Pinecone metadata `activity_tags` array
- Usage: Activity-based filtering when retrieving relevant regulations

## Entry Points

**PRIMARY (Phase 1 - Data Pipeline):**

**Scheduled Data Ingestion:**
- Location: `workers/scheduled/src/index.ts`
- Triggers: Weekly (MVP) or daily (P1) cron schedule
- Responsibilities: Identify sources, dispatch to appropriate ingestion worker

**API Ingestion Worker (Federal):**
- Location: `workers/ingestion-api/src/index.ts`
- Triggers: Scheduled worker or queue message
- Responsibilities: Fetch from federal APIs (eCFR, Federal Register), parse XML/JSON, enqueue to ingest-queue

**Firecrawl Scraping Worker (State/Local):**
- Location: `workers/ingestion-scraper/src/index.ts`
- Triggers: Scheduled worker or queue message
- Responsibilities: Call Firecrawl API for JS-rendered sites (Municode, Texas Statutes, American Legal), receive clean Markdown, enqueue to ingest-queue

**Embedding Queue Consumer:**
- Location: `workers/embedding/src/index.ts`
- Triggers: Message in embedding-queue
- Responsibilities: Call OpenAI embedding API, upsert vectors to Pinecone with metadata

**Convex Query Execution (HTTP API):**
- Location: `apps/convex/http.ts` - HTTP action endpoints
- Triggers: HTTP POST from curl/Postman/external consumers
- Responsibilities: Orchestrate query pipeline (geocoding → search → rank → LLM → parse), return JSON response

**DEFERRED (Phase 2 - Frontend):**

**React Frontend:**
- Location: `apps/web/src/main.tsx`
- Triggers: User opens application URL
- Responsibilities: Initialize Convex and Clerk providers, mount chat interface component, establish real-time subscriptions

## Error Handling

**Strategy:** Graceful degradation with logging and user notification

**Patterns:**

- **Query Execution Errors:** Action catches exceptions, writes error message to Convex with `status: "error"` and `errorMessage`, frontend displays error banner to user
- **Vector Search No Results:** Action continues with empty context, Claude generates response noting lack of regulation data for jurisdiction
- **External API Failures (Mapbox, OpenAI, Claude):** Action catches and logs, increments retry counter in message, user sees processing state; sync worker retries ingestion on transient failures
- **Unauthorized API Access:** Convex HTTP action validates Clerk token, Workers REST API validates API key header; invalid requests return 401 with "Unauthorized"
- **Rate Limiting:** Cloudflare Workers have built-in rate limiting on external REST API; exceeded limits return 429
- **Database Constraints:** Convex mutations validate all required fields, return validation error to user

## Cross-Cutting Concerns

**Logging:**
- Approach: Structured logging to stdout (Convex/Workers) and browser console (React)
- Key events: Query start/end, API calls, search results count, LLM response time, ingestion completion
- Format: JSON with timestamp, service, level, message, context

**Validation:**
- Frontend: Input validation on message text (non-empty, max 5000 chars), address validation for location queries
- Backend: Convex schema enforces field types, HTTP actions validate API key format
- Data Pipeline: Chunker validates text length, embedder validates vector dimensions

**Authentication:**
- Frontend: Clerk SDK handles user auth, Convex `getAuthUser` helper verifies token before query execution
- HTTP Actions: Clerk token validation required for user-facing endpoints
- External REST API: API key validation in `external-api/middleware/auth.ts`
- Workers: Cloudflare deploy key for Convex calls, OPENAI_API_KEY/PINECONE_API_KEY as environment variables

**Rate Limiting:**
- Frontend: User-side debouncing on message input (300ms)
- HTTP API: Cloudflare Workers built-in rate limiting (per IP, per API key)
- LLM Calls: Convex action queues requests, Claude API has rate limits, exponential backoff on 429

**Caching:**
- Cloudflare KV: Future optimization for repeated queries (cache embedding + top results)
- Pinecone: Metadata-filtered searches implicitly cache jurisdictions by filtering at query time
- React Query: Frontend caches conversation list and message list via `useQuery` subscriptions

---

*Architecture analysis: 2026-01-31*
*Updated: 2026-01-31 — Backend-first scope, Firecrawl replaces Browserless.io*
