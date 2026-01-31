# Roadmap: ComplianceIQ

**Project:** Texas pilot for regulatory compliance AI
**Core Value:** Lawyers can get cited regulatory answers in minutes instead of hours
**Depth:** Comprehensive (10 phases)
**Total Requirements:** 28 v1 requirements

---

## Overview

This roadmap delivers ComplianceIQ in 10 phases, building data pipelines layer by layer (federal → state → county → municipal), then the query/RAG system, then the application. Each phase delivers a complete, verifiable capability that unblocks the next phase.

**Delivery Strategy:**
- Phases 1-6: Data pipelines (foundation → federal → state → county → municipal → processing)
- Phases 7-8: Query engine and application layer
- Phases 9-10: Integration polish and pilot readiness

**Coverage:** All 28 v1 requirements mapped to phases. Coverage requirements (COV-01 through COV-05) are validated throughout Phases 2-5 as data is ingested.

---

## Phases

| Phase | Goal | Requirements | Dependencies |
|-------|------|--------------|--------------|
| 1 - Foundation | Project infrastructure and services operational | — | None |
| 2 - Federal Data | Federal regulations indexed and searchable | DATA-01, DATA-07, DATA-08, DATA-09, DATA-10, COV-01 | Phase 1 |
| 3 - State Data | Texas state law and regulations indexed | DATA-02, DATA-03, COV-02, COV-03 | Phase 2 |
| 4 - County Data | Top 10 Texas county ordinances indexed | DATA-06, COV-04 | Phase 3 |
| 5 - Municipal Data | Top 20 Texas city codes indexed | DATA-04, DATA-05, COV-05 | Phase 4 |
| 6 - Data Processing | Chunking, embedding, and indexing pipeline operational | (validates DATA-07, DATA-08, DATA-09, DATA-10) | Phase 5 |
| 7 - Query Pipeline | RAG system returns relevant regulatory text with citations | QUERY-01, QUERY-02, QUERY-03, QUERY-04, QUERY-06, QUERY-07 | Phase 6 |
| 8 - Application | Users can authenticate and ask compliance questions | APP-01, APP-02, APP-03, APP-04, APP-06 | Phase 7 |
| 9 - Integration | Real-time streaming, citations, and feedback working | QUERY-05, APP-05 | Phase 8 |
| 10 - Pilot Preparation | System validated and ready for Costco pilot users | — | Phase 9 |

---

## Phase 1: Foundation

**Goal:** Project infrastructure and services operational

**Dependencies:** None

**Requirements Covered:** None directly (infrastructure phase)

**Success Criteria:**
1. Monorepo with pnpm workspaces contains Convex app, Cloudflare Workers, and React frontend
2. Convex schema defined with jurisdictions, sources, conversations, messages tables
3. Pinecone index created (3072 dimensions, cosine metric)
4. Cloudflare R2 bucket and Workers environment configured
5. Basic CI/CD pipeline runs tests and lints code

**Deliverables:**
- Monorepo structure with packages/apps
- Convex project with initial schema
- Pinecone index provisioned
- Cloudflare Workers project structure
- React app scaffolding with Tailwind
- Development environment documentation

---

## Phase 2: Federal Data

**Goal:** Federal regulations indexed and searchable via Pinecone

**Dependencies:** Phase 1

**Requirements Covered:**
- DATA-01: eCFR API integration returns federal regulation text with citations
- DATA-07: Chunking pipeline splits regulatory text into embeddable segments with metadata
- DATA-08: Embedding pipeline generates vectors via OpenAI text-embedding-3-large
- DATA-09: Pinecone index stores vectors with jurisdiction/activity/citation metadata
- DATA-10: R2 storage persists raw scraped documents for audit/reprocessing
- COV-01: Federal regulations covering Costco business activities (food, alcohol, pharmacy, fuel, employment)

**Success Criteria:**
1. Cloudflare Worker fetches all relevant CFR titles from eCFR API (7, 9, 21, 27, 29, 40, 49)
2. Raw federal regulation text stored in R2 with timestamps
3. Federal regulations chunked with section-level granularity and metadata
4. OpenAI embeddings generated for all federal chunks
5. Federal regulatory chunks searchable in Pinecone with jurisdiction filter "federal"

**Deliverables:**
- eCFR API integration worker
- Federal data ingestion pipeline (API → R2 → chunking → embedding → Pinecone)
- Sync worker updates Convex sources table with federal freshness
- Test query returns relevant federal regulations

---

## Phase 3: State Data

**Goal:** Texas state law and regulations indexed and searchable

**Dependencies:** Phase 2

**Requirements Covered:**
- DATA-02: Texas Statutes scraper extracts all 28 codes with section-level granularity
- DATA-03: Texas Administrative Code scraper extracts relevant titles (16, 22, 25, 30, 37)
- COV-02: Texas state statutes relevant to retail operations
- COV-03: Texas Administrative Code for licensing boards (pharmacy, optometry, alcohol)

**Success Criteria:**
1. Texas Statutes scraper extracts all 28 codes from capitol.texas.gov
2. Texas Administrative Code scraper extracts 5 relevant titles from SOS or Cornell LII
3. State regulatory text stored in R2 with source URLs and timestamps
4. State regulations chunked and embedded with "tx-state" jurisdiction metadata
5. Test queries return relevant Texas statutes and admin code sections

**Deliverables:**
- Texas Statutes scraper (Cloudflare Worker)
- Texas Admin Code scraper (Cloudflare Worker or Cornell LII)
- State data processing pipeline (scrape → R2 → chunk → embed → Pinecone)
- Convex sources table tracks Texas statute and TAC freshness

---

## Phase 4: County Data

**Goal:** Top 10 Texas county ordinances indexed and searchable

**Dependencies:** Phase 3

**Requirements Covered:**
- DATA-06: County regulation scraper extracts from top 10 Texas counties
- COV-04: Top 10 Texas counties by Costco presence (Harris, Dallas, Tarrant, Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso)

**Success Criteria:**
1. County scraper extracts ordinances from 10 target counties
2. County data stored in R2 with jurisdiction identifiers
3. County regulations chunked and embedded with county jurisdiction metadata (e.g., "tx-harris")
4. Test queries filtered by county return relevant local regulations
5. Convex jurisdictions table lists all 10 counties with coverage status

**Deliverables:**
- County scraper supporting multiple county website formats
- County data processing pipeline
- Jurisdiction mapping: address → county FIPS code
- Test coverage report for 10 counties

---

## Phase 5: Municipal Data

**Goal:** Top 20 Texas city codes indexed and searchable

**Dependencies:** Phase 4

**Requirements Covered:**
- DATA-04: Municode scraper extracts ordinances from 15+ Texas cities
- DATA-05: American Legal scraper extracts ordinances from Dallas, Fort Worth, Austin
- COV-05: Top 20 Texas cities by Costco presence (Houston, San Antonio, Dallas, Austin, Fort Worth, El Paso, Arlington, Plano, Corpus Christi, Lubbock, Laredo, Irving, Garland, Frisco, McKinney, Amarillo, Grand Prairie, Brownsville, Killeen, Pasadena)

**Success Criteria:**
1. Municode scraper extracts municipal codes from 17 Texas cities
2. American Legal scraper extracts codes from Dallas, Fort Worth, Austin
3. All 20 city codes stored in R2 with city identifiers
4. City ordinances chunked and embedded with municipal jurisdiction metadata
5. Test queries filtered by city return relevant municipal codes

**Deliverables:**
- Municode scraper (Cloudflare Worker + Browserless.io for JS rendering)
- American Legal scraper
- Municipal data processing pipeline
- Convex jurisdictions table lists all 20 cities
- Coverage report: all 20 cities indexed

---

## Phase 6: Data Processing

**Goal:** Chunking, embedding, and indexing pipeline validated end-to-end

**Dependencies:** Phase 5

**Requirements Covered:**
- Validates DATA-07: Chunking pipeline splits regulatory text into embeddable segments with metadata
- Validates DATA-08: Embedding pipeline generates vectors via OpenAI text-embedding-3-large
- Validates DATA-09: Pinecone index stores vectors with jurisdiction/activity/citation metadata
- Validates DATA-10: R2 storage persists raw scraped documents for audit/reprocessing

**Success Criteria:**
1. All ingested sources (federal, state, county, municipal) successfully chunked
2. All chunks have embeddings generated and stored in Pinecone
3. Pinecone metadata includes jurisdiction, source type, citation, activity tags, URLs
4. R2 stores raw documents in organized folder structure by jurisdiction
5. Sync worker successfully updates Convex with data freshness metrics

**Deliverables:**
- End-to-end data pipeline validation
- Chunking strategy documentation (section-level for statutes, topic-based for ordinances)
- Metadata schema finalized in Pinecone
- R2 folder structure documented
- Data quality report (chunk count, coverage gaps, broken citations)

---

## Phase 7: Query Pipeline

**Goal:** RAG system returns relevant regulatory text with citations

**Dependencies:** Phase 6

**Requirements Covered:**
- QUERY-01: User can ask natural language compliance questions
- QUERY-02: System resolves address to applicable jurisdictions (federal, state, county, municipal)
- QUERY-03: RAG pipeline retrieves relevant regulatory chunks from Pinecone
- QUERY-04: Claude generates response with inline citations to source law
- QUERY-06: Citations link to original source text (URLs or document references)
- QUERY-07: Response identifies required permits/licenses with issuing agency

**Success Criteria:**
1. User submits natural language query and receives regulatory answer
2. Address in query triggers geocoding (Mapbox) and jurisdiction resolution
3. Pinecone vector search returns top 20 relevant chunks filtered by jurisdiction
4. Claude LLM generates response citing specific statutes, regulations, ordinances
5. Response includes permit/license requirements with agency names and URLs

**Deliverables:**
- Convex action: query.execute (geocode → search → LLM → parse → store)
- Mapbox integration for address → jurisdiction resolution
- Pinecone search with metadata filtering
- Claude prompt engineering for compliance responses with citations
- Citation parser extracts structured references from LLM output

---

## Phase 8: Application

**Goal:** Users can authenticate and ask compliance questions via web UI

**Dependencies:** Phase 7

**Requirements Covered:**
- APP-01: User can sign up and log in via Clerk authentication
- APP-02: User can create new conversations
- APP-03: User can view conversation history
- APP-04: User can continue previous conversations with context preserved
- APP-06: System tracks message status (pending, processing, streaming, complete, error)

**Success Criteria:**
1. User can sign up with email/password via Clerk
2. Authenticated user can create a new conversation
3. User can view list of all their conversations
4. User can reopen past conversations and continue with context
5. Message status updates in real-time (pending → processing → complete)

**Deliverables:**
- React frontend with Clerk authentication
- Convex queries: conversations.list, messages.byConversation
- Convex mutations: conversations.create, messages.send
- Chat interface with message list and input
- Conversation history sidebar
- Real-time message status indicators

---

## Phase 9: Integration

**Goal:** Real-time streaming, citations, and feedback working end-to-end

**Dependencies:** Phase 8

**Requirements Covered:**
- QUERY-05: Response streams in real-time as Claude generates
- APP-05: User can provide feedback (helpful/not helpful) on responses

**Success Criteria:**
1. Claude responses stream to UI in real-time as tokens arrive
2. Citations render as clickable links to source legal text
3. User can click thumbs up/thumbs down on any assistant message
4. Feedback stored in Convex with message reference
5. Streaming updates conversation UI without full page refresh

**Deliverables:**
- Streaming response implementation (Convex action → message updates → React)
- Citation rendering component with source links
- Feedback mutation and UI (thumbs up/down)
- Convex feedback table tracking helpful/not_helpful ratings
- Polish: loading states, error handling, retry logic

---

## Phase 10: Pilot Preparation

**Goal:** System validated and ready for Costco pilot users

**Dependencies:** Phase 9

**Requirements Covered:** None directly (validation phase)

**Success Criteria:**
1. 100 sample queries tested with >90% citation accuracy
2. All 40+ Texas Costco warehouse addresses resolve to correct jurisdictions
3. Response time P95 <10 seconds for typical queries
4. All data sources show "active" status with last_updated within 7 days
5. Costco pilot users (5-10) have accounts and access

**Deliverables:**
- Test suite with 100 representative compliance queries
- Accuracy evaluation report (citation validity, response correctness)
- Performance benchmarks (latency, token usage, costs)
- Data freshness audit for all jurisdictions
- Pilot user onboarding documentation
- Known issues and limitations documented
- Feedback collection process established

---

## Progress Tracking

| Phase | Status | Start Date | End Date | Requirements |
|-------|--------|------------|----------|--------------|
| 1 - Foundation | Pending | TBD | TBD | — |
| 2 - Federal Data | Pending | TBD | TBD | 6 |
| 3 - State Data | Pending | TBD | TBD | 4 |
| 4 - County Data | Pending | TBD | TBD | 2 |
| 5 - Municipal Data | Pending | TBD | TBD | 3 |
| 6 - Data Processing | Pending | TBD | TBD | 4 (validation) |
| 7 - Query Pipeline | Pending | TBD | TBD | 6 |
| 8 - Application | Pending | TBD | TBD | 5 |
| 9 - Integration | Pending | TBD | TBD | 2 |
| 10 - Pilot Preparation | Pending | TBD | TBD | — |

---

## Notes

**Coverage Requirements:** COV-01 through COV-05 are validated during data ingestion phases (2-5) rather than being separate deliverables. Each coverage requirement confirms that data for specific jurisdictions or activities is successfully indexed.

**Data Pipeline Pattern:** Phases 2-5 follow the same pattern: fetch/scrape → R2 storage → chunking → embedding → Pinecone indexing → Convex metadata sync. This repetition builds confidence and allows parallel development once the pattern is established.

**Infrastructure Phases:** Phases 1 (Foundation) and 10 (Pilot Preparation) are non-feature phases. They set up infrastructure and validate quality before customer delivery.

**Research Context:** See doc_planning/ for detailed technical architecture, data sources, and PRD that informed this roadmap.

---

*Roadmap created: 2026-01-31*
*Last updated: 2026-01-31*
