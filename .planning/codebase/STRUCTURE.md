# Codebase Structure

**Analysis Date:** 2026-01-31
**Last Updated:** 2026-01-31

## Directory Layout

**Phase 1 (Backend-First) directories marked with ✅**
**Phase 2 (Frontend) directories marked with 📋**

```
compliance-iq/
├── package.json                        # Root workspace manifest ✅
├── pnpm-workspace.yaml                 # pnpm workspaces configuration ✅
│
├── apps/
│   ├── web/                            # 📋 React frontend (PHASE 2 - DEFERRED)
│   │   └── ...                         # Build later once backend validated
│   │
│   └── convex/                         # ✅ Convex backend (application layer)
│       ├── package.json
│       ├── convex.json                 # Convex project config
│       ├── schema.ts                   # Database schema definition
│       ├── _generated/                 # Auto-generated types (do not edit)
│       │   └── ...
│       ├── functions/                  # Convex queries and mutations
│       │   ├── conversations.ts        # Conversation CRUD
│       │   ├── messages.ts             # Message CRUD
│       │   ├── jurisdictions.ts        # Jurisdiction queries
│       │   ├── sources.ts              # Data source metadata
│       │   └── feedback.ts             # User feedback mutations
│       ├── actions/                    # Convex actions (server-side, external APIs)
│       │   ├── query.ts                # Main RAG query execution
│       │   ├── geocode.ts              # Mapbox address-to-jurisdiction resolution
│       │   ├── pinecone.ts             # Vector search and reranking
│       │   └── claude.ts               # Claude LLM calls and response parsing
│       ├── http.ts                     # HTTP actions for external API access
│       └── lib/
│           ├── embeddings.ts           # Embedding utilities (OpenAI calls)
│           ├── citations.ts            # Citation parsing and normalization
│           └── auth.ts                 # Auth helpers (Clerk token validation)
│
├── workers/                            # ✅ Cloudflare Workers (data pipeline)
│   ├── ingestion-api/                  # ✅ Federal API ingestion worker
│   │   ├── package.json
│   │   ├── wrangler.toml               # Cloudflare worker config
│   │   ├── src/
│   │   │   ├── index.ts                # Worker entry point (scheduled)
│   │   │   ├── sources/
│   │   │   │   ├── ecfr.ts             # eCFR API client (MVP)
│   │   │   │   ├── federal-register.ts # Federal Register API client (P1)
│   │   │   │   └── legiscan.ts         # LegiScan API client (P1)
│   │   │   └── lib/
│   │   │       └── r2.ts               # Cloudflare R2 helpers
│   │   └── tsconfig.json
│   │
│   ├── ingestion-scraper/              # ✅ Web scraping worker (via Firecrawl)
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   ├── index.ts                # Worker entry point
│   │   │   ├── scrapers/               # Scraper configurations (Firecrawl calls)
│   │   │   │   ├── texas-statutes.ts   # Texas Statutes (Firecrawl → Markdown)
│   │   │   │   ├── texas-admin-code.ts # Texas Admin Code (Firecrawl → Markdown)
│   │   │   │   ├── municode.ts         # Municode cities (Firecrawl → Markdown)
│   │   │   │   └── american-legal.ts   # American Legal (Firecrawl → Markdown)
│   │   │   └── lib/
│   │   │       └── firecrawl.ts        # Firecrawl API client (replaces browserless.ts)
│   │   └── tsconfig.json
│   │
│   ├── embedding/                      # ✅ Embedding and indexing worker
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   ├── index.ts                # Queue consumer entry point
│   │   │   └── lib/
│   │   │       ├── chunker.ts          # Markdown → chunks (500 token overlap)
│   │   │       ├── openai.ts           # OpenAI embedding API client
│   │   │       └── pinecone.ts         # Pinecone upsert helper
│   │   └── tsconfig.json
│   │
│   ├── sync/                           # ✅ Metadata sync worker (Cloudflare → Convex)
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   └── index.ts                # Syncs jurisdictions and sources to Convex
│   │   └── tsconfig.json
│   │
│   ├── external-api/                   # 📋 REST API for external consumers (PHASE 2)
│   │   └── ...                         # Build later for third-party access
│   │
│   └── scheduled/                      # ✅ Cron trigger worker
│       ├── package.json
│       ├── wrangler.toml               # Cron schedule configuration
│       ├── src/
│       │   └── index.ts                # Orchestrates ingestion workers
│       └── tsconfig.json
│
├── packages/                           # ✅ Shared packages (monorepo)
│   ├── types/                          # ✅ Shared TypeScript type definitions
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── jurisdiction.ts         # Jurisdiction type definitions
│   │       ├── source.ts               # Source type definitions
│   │       ├── chunk.ts                # Chunk metadata schema
│   │       └── citation.ts             # Citation type definitions
│   │
│   ├── shared/                         # ✅ Shared utilities and helpers
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── citations.ts            # ✅ Citation normalization (CRITICAL for MVP)
│   │       └── jurisdictions.ts        # Jurisdiction matching utilities
│   │
│   └── config/                         # ✅ Shared configuration constants
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── jurisdictions.ts        # Jurisdiction definitions and hierarchy
│           └── activities.ts           # Business activity tag definitions
│
├── scripts/                            # Development and deployment scripts
│   ├── seed-jurisdictions.ts           # Seed Convex with jurisdiction reference data
│   ├── test-ecfr.ts                    # Test eCFR API integration
│   └── validate-pinecone.ts            # Validate Pinecone index metadata
│
├── .github/
│   └── workflows/
│       ├── deploy-convex.yml           # Deploy Convex backend
│       ├── deploy-workers.yml          # Deploy Cloudflare Workers
│       └── deploy-frontend.yml         # Deploy React frontend
│
├── docs/                               # User-facing documentation
│   ├── api.md                          # REST API documentation
│   └── deployment.md                   # Deployment guide
│
└── .planning/
    └── codebase/                       # Architecture analysis documents (this directory)
        ├── ARCHITECTURE.md
        ├── STRUCTURE.md
        ├── CONVENTIONS.md
        ├── TESTING.md
        ├── CONCERNS.md
        ├── STACK.md
        └── INTEGRATIONS.md
```

## Directory Purposes

### Phase 1 - Backend/Data Pipeline (Build First)

**apps/convex:** ✅ PRIMARY
- Purpose: Backend application layer with real-time database and query orchestration
- Contains: Database schema, queries, mutations, actions, HTTP endpoints
- Key files: `schema.ts`, `actions/query.ts` (main RAG execution), `http.ts` (API endpoints for testing)

**workers/ingestion-api:** ✅ PRIMARY
- Purpose: Fetch regulatory data from federal APIs
- Contains: API clients for eCFR (MVP), Federal Register (P1), LegiScan (P1)
- Key files: `src/sources/ecfr.ts`

**workers/ingestion-scraper:** ✅ PRIMARY
- Purpose: Scrape state/local regulatory sites via Firecrawl
- Contains: Firecrawl API client, scraper configurations per source
- Key files: `src/lib/firecrawl.ts`, `src/scrapers/texas-statutes.ts`, `src/scrapers/municode.ts`

**workers/embedding:** ✅ PRIMARY
- Purpose: Convert Markdown chunks to embeddings and index in Pinecone
- Contains: Markdown chunking logic, OpenAI embedding client, Pinecone upsert
- Key files: `src/lib/chunker.ts`, `src/lib/openai.ts`, `src/lib/pinecone.ts`

**workers/sync:** ✅ PRIMARY
- Purpose: Synchronize ingested data metadata from Cloudflare to Convex
- Contains: Convex HTTP client calls to update sources and jurisdictions tables
- Key files: `src/index.ts`

**workers/scheduled:** ✅ PRIMARY
- Purpose: Cron-triggered orchestration of data ingestion pipeline
- Contains: Schedule configuration, decision logic to dispatch to ingesters
- Key files: `src/index.ts` (cron handler)

**packages/shared:** ✅ CRITICAL
- Purpose: Citation normalization (must be built early!)
- Contains: Citation parsing, jurisdiction matching utilities
- Key files: `src/citations.ts` (build this first)

### Phase 2 - Frontend (Build Later)

**apps/web:** 📋 DEFERRED
- Purpose: React frontend application for end users
- Build after: Backend is validated with curl/Postman testing

**workers/external-api:** 📋 DEFERRED
- Purpose: REST API for third-party consumers
- Build after: Core query functionality proven

**packages/types:**
- Purpose: Centralized TypeScript type definitions shared across monorepo
- Contains: Interface definitions for data structures (chunks, citations, jurisdictions)
- Key files: `src/chunk.ts` (Pinecone metadata schema), `src/citation.ts`

**packages/shared:**
- Purpose: Reusable utilities and helper functions
- Contains: Citation normalization, jurisdiction matching logic
- Key files: `src/citations.ts`, `src/jurisdictions.ts`

**packages/config:**
- Purpose: Configuration constants and reference data
- Contains: Jurisdiction hierarchy, activity tag definitions
- Key files: `src/jurisdictions.ts`, `src/activities.ts`

## Key File Locations

**Entry Points:**
- `apps/web/src/main.tsx`: React app initialization (Convex + Clerk providers)
- `apps/convex/actions/query.ts`: Query execution action (called when user sends message)
- `workers/scheduled/src/index.ts`: Data ingestion orchestration (cron trigger)

**Configuration:**
- `apps/convex/schema.ts`: Full database schema (tables, indexes)
- `apps/web/vite.config.ts`: Frontend build configuration
- `workers/*/wrangler.toml`: Each worker's Cloudflare configuration

**Core Logic:**
- `apps/convex/actions/query.ts`: Main RAG pipeline (geocoding → search → LLM → parse)
- `workers/embedding/src/lib/chunker.ts`: Text chunking algorithm
- `apps/web/src/components/chat/ChatInterface.tsx`: Chat UI state and rendering
- `packages/shared/src/citations.ts`: Citation extraction and normalization

**Testing:**
- `apps/web/src/components/**/*.test.tsx`: React component tests (co-located)
- `apps/convex/**/*.test.ts`: Convex function tests
- `workers/**/src/**/*.test.ts`: Worker unit tests

## Naming Conventions

**Files:**
- React components: PascalCase, `.tsx` extension (e.g., `ChatInterface.tsx`, `MessageList.tsx`)
- Utility functions: camelCase, `.ts` extension (e.g., `utils.ts`, `citations.ts`)
- Database schemas/types: camelCase, `.ts` extension (e.g., `schema.ts`, `chunk.ts`)
- API clients: camelCase, `.ts` extension (e.g., `pinecone.ts`, `openai.ts`)
- Test files: suffixed with `.test.ts` or `.spec.ts`

**Directories:**
- Feature directories: kebab-case (e.g., `chat/`, `external-api/`, `ingestion-api/`)
- Component directories: camelCase (e.g., `components/chat/`, `components/dashboard/`)
- Utility/helper directories: camelCase or single word (e.g., `lib/`, `hooks/`, `actions/`)

**Functions and Variables:**
- Functions: camelCase (e.g., `executeQuery`, `geocodeAddress`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_TOKENS`, `DEFAULT_TOPK`)
- React hooks: camelCase prefixed with `use` (e.g., `useConversations`, `useCompliance`)
- Type names: PascalCase (e.g., `ChunkMetadata`, `ConversationWithMessages`)

**Types:**
- Interfaces: PascalCase (e.g., `Message`, `Citation`, `JurisdictionResult`)
- Enums: PascalCase (e.g., `MessageRole`, `SourceType`)
- Union types: UPPER_SNAKE_CASE (e.g., `JURISDICTION_TYPE`)

## Where to Add New Code

**New Feature (e.g., feedback system):**
- Primary code: `apps/convex/functions/feedback.ts` (queries/mutations), `apps/convex/actions/feedback.ts` (if external API calls needed)
- Frontend: `apps/web/src/components/feedback/FeedbackWidget.tsx`, `apps/web/src/hooks/useFeedback.ts`
- Tests: `apps/convex/functions/feedback.test.ts`, `apps/web/src/components/feedback/FeedbackWidget.test.tsx`
- Types: `packages/types/src/feedback.ts` if shared across backend/workers

**New Component/Module (e.g., jurisdiction selector):**
- Implementation: `apps/web/src/components/dashboard/JurisdictionSelector.tsx`
- Hook: `apps/web/src/hooks/useJurisdictionSelector.ts` if complex state
- Styles: Co-locate with component using Tailwind classes
- Tests: `apps/web/src/components/dashboard/JurisdictionSelector.test.tsx`

**Utilities:**
- Shared helpers (used across monorepo): `packages/shared/src/`
- Frontend-only utilities: `apps/web/src/lib/`
- Convex-only utilities: `apps/convex/lib/`
- Worker-specific utilities: `workers/{worker-name}/src/lib/`

**New Scraper (e.g., California statutes):**
- Implementation: `workers/ingestion-scraper/src/scrapers/california-statutes.ts`
- Register in: `workers/ingestion-scraper/src/index.ts` (add to source dispatcher)
- Shared types: `packages/types/src/source.ts` (update if new source type)

**New External API Endpoint (e.g., feedback endpoint):**
- Route: `workers/external-api/src/routes/feedback.ts`
- Register in: `workers/external-api/src/index.ts` (add route to Hono router)
- Auth/validation: Use existing middleware from `workers/external-api/src/middleware/auth.ts`

## Special Directories

**apps/convex/_generated:**
- Purpose: Auto-generated TypeScript types from Convex schema
- Generated: Yes (by Convex CLI)
- Committed: Yes, to version control
- Action: Do not manually edit; regenerate with `convex codegen`

**apps/web/public:**
- Purpose: Static assets (images, icons, fonts)
- Generated: No
- Committed: Yes
- Served: Directly by Vite dev server and bundled in production

**workers/*/node_modules:**
- Purpose: Installed npm dependencies
- Generated: Yes (by pnpm install)
- Committed: No (use pnpm-lock.yaml)
- Action: Never commit

**.planning/codebase:**
- Purpose: Architecture analysis and reference documents
- Generated: Yes (by mapping agents)
- Committed: Yes
- Usage: Read by planning and execution agents to understand structure/conventions

**docs:**
- Purpose: User-facing documentation
- Generated: No
- Committed: Yes
- Audience: API consumers, deployers, developers

---

*Structure analysis: 2026-01-31*
*Updated: 2026-01-31 — Backend-first phase markers, Firecrawl integration*
