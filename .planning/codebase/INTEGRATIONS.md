# External Integrations

**Analysis Date:** 2026-01-31
**Last Updated:** 2026-01-31

## APIs & External Services

**LLM & AI:**
- **Anthropic Claude API** - Primary LLM for compliance query reasoning and response generation
  - SDK/Client: `anthropic` npm package
  - Auth: Environment variable `ANTHROPIC_API_KEY`
  - Usage: Called from Convex actions (`convex/query.ts`)
  - Features: Streaming responses, citation parsing, confidence scoring

**Embeddings:**
- **OpenAI Embeddings API** - Text embeddings for regulatory documents
  - SDK/Client: `openai` npm package
  - Auth: Environment variable `OPENAI_API_KEY`
  - Model: `text-embedding-3-large` (3072 dimensions)
  - Usage: Cloudflare embedding worker generates embeddings, batch processed from queue

**Vector Search & Storage:**
- **Pinecone** - Vector database for regulatory text
  - SDK/Client: `pinecone-client` npm package
  - Auth: Environment variable `PINECONE_API_KEY`, `PINECONE_INDEX`, `PINECONE_ENVIRONMENT`
  - Index name: `compliance-iq-prod`
  - Dimensions: 3072 (matching text-embedding-3-large)
  - Metadata filters: `jurisdiction_id`, `jurisdiction_type`, `source_type`, `activity_tags`, `effective_date`

**Geocoding & Location Services:**
- **Mapbox** - Address-to-coordinates and jurisdiction resolution
  - SDK/Client: `@mapbox/mapbox-sdk` or direct REST calls
  - Auth: Environment variable `MAPBOX_ACCESS_TOKEN`
  - Usage: Convex action `address.resolve()` - called before queries
  - Free tier: 100K requests/month (sufficient for MVP)

**Authentication & Identity:**
- **Clerk** - User auth, sessions, and org management
  - Implementation: `@clerk/clerk-react` (frontend), `@clerk/backend` (Convex backend)
  - Auth keys: `VITE_CLERK_KEY` (frontend publishable), `CLERK_SECRET_KEY` (backend)
  - Integration: `ConvexProviderWithClerk` wrapper in React app
  - User table in Convex schema: `users` with `clerkId` index

## Data Ingestion Sources

**Federal Level:**
- **eCFR (Electronic Code of Federal Regulations)** - REST API
  - Endpoint: https://www.ecfr.gov/developers
  - Method: HTTP REST
  - Authentication: None required (public API)
  - Frequency: MVP ingests weekly, P1 daily polling for updates
  - Implementation: `workers/ingestion-api/src/sources/ecfr.ts`

- **Federal Register API** - Proposed and final rules (P1, not MVP)
  - Endpoint: https://www.federalregister.gov/developers
  - Method: HTTP REST
  - Authentication: None required
  - Use case: Change tracking and alerts (P1 feature)

- **Congress.gov API** - Bills and enacted laws (P1, not MVP)
  - Endpoint: https://api.congress.gov/
  - Method: HTTP REST
  - Authentication: None required
  - Use case: Bill tracking and future law changes

- **LegiScan API** - Bill tracking and monitoring (P1)
  - Auth: Environment variable `LEGISCAN_API_KEY`
  - Method: HTTP REST
  - Use case: Daily checks for Texas bills affecting compliance, change alerts
  - Implementation: `workers/ingestion-api/src/sources/legiscan.ts`

**State Level (Texas MVP):**
- **Texas Statutes** - Scraped from https://statutes.capitol.texas.gov/
  - Method: HTML scraping (Cheerio for static HTML)
  - Implementation: `workers/ingestion-scraper/src/scrapers/texas-statutes.ts`
  - Frequency: Weekly re-scrape in MVP

- **Texas Administrative Code (TAC)** - Scraped from Cornell LII
  - Method: HTML scraping
  - Implementation: `workers/ingestion-scraper/src/scrapers/texas-admin-code.ts`
  - Focus: Titles 16, 22, 25, 30, 37

**Local Level (MVP - Texas Counties & Cities):**
- **Municode/CivicPlus** - Municipal codes (4,200+ jurisdictions)
  - Endpoint: https://www.municode.com/
  - Method: Firecrawl API (handles JS rendering, returns Markdown)
  - Auth: `FIRECRAWL_API_KEY`
  - Implementation: `workers/ingestion-scraper/src/scrapers/municode.ts`
  - Scope (MVP): Top 10 Texas cities (Houston, Dallas, San Antonio, Austin, Fort Worth, El Paso, Arlington, Corpus Christi, Plano, Laredo)

- **American Legal Publishing** - Municipal codes for Dallas, Fort Worth areas
  - Endpoint: americanlegal.com domains
  - Method: Firecrawl API (returns Markdown)
  - Implementation: `workers/ingestion-scraper/src/scrapers/american-legal.ts`

- **County Ordinances** - Direct from county websites
  - Method: Firecrawl API + PDF extraction where needed
  - Scope (MVP): Top 5 Texas counties (Harris, Dallas, Tarrant, Bexor, Travis)

**Scraping Infrastructure:**
- **Firecrawl** - Web scraping API with built-in JS rendering (replaces Browserless.io)
  - SDK/Client: `firecrawl` npm package or direct REST API
  - Auth: Environment variable `FIRECRAWL_API_KEY`
  - Endpoint: https://api.firecrawl.dev/v1/scrape
  - Output: Clean Markdown (LLM-ready) or structured JSON
  - Usage: Called from Cloudflare scraper workers for Municode, Texas Statutes, American Legal, and other JS-heavy sites
  - Key advantage: Returns Markdown directly — no HTML parsing needed, reduces worker complexity
  - Pricing: Free tier (500 pages/mo), Starter $16/mo (3,000 pages), Growth $83/mo (25,000 pages)
  - Features: Anti-bot bypass, automatic JS rendering, structured data extraction

**Why Firecrawl over Browserless.io:**
1. Returns clean Markdown instead of raw HTML — eliminates HTML parsing code
2. Built for AI/RAG workflows — output is already LLM-ready
3. Lower cost ($16/mo vs $50-100/mo for similar volume)
4. Simpler integration — no headless browser management

**Document Processing:**
- **PDF Extraction** - For county regulations and administrative codes in PDF format
  - Tools considered: `pdfjs`, Tesseract.js (OCR), Azure Document Intelligence
  - Usage: If PDFs encountered during scraping (Firecrawl can also handle some PDFs)

## Data Storage

**Document Storage:**
- **Cloudflare R2** - Object storage for raw ingested documents
  - Binding name: `DOCUMENTS`
  - Bucket: `compliance-iq-documents`
  - Structure:
    - `/raw/federal/cfr/...` - Federal regulations
    - `/raw/tx/statutes/...` - Texas statutes
    - `/raw/tx/admin-code/...` - Texas admin code
    - `/raw/tx/counties/...` - County ordinances
    - `/raw/tx/cities/...` - City municipal codes
    - `/processed/chunks/...` - Extracted text chunks
    - `/logs/ingestion/...` - Pipeline logs
  - Access: From Cloudflare Workers via R2 bindings
  - Cost: ~$15/month for 50GB storage + 10M requests (MVP scale)

**Message Queues:**
- **Cloudflare Queues** - Task queue for async processing
  - Queues used:
    - `ingest-queue` - Raw documents to process
    - `embedding-queue` - Chunks to embed via OpenAI
    - `index-queue` - Embeddings to upsert into Pinecone
  - Producer/Consumer: Cloudflare Workers written via `wrangler.toml` bindings
  - Binding names: `INGEST_QUEUE`, `EMBEDDING_QUEUE`, `INDEX_QUEUE`

**Application Database:**
- **Convex** - Serverless data store for application state
  - Tables:
    - `users` - Clerk integration with org/role fields
    - `conversations` - Chat sessions with metadata (address, jurisdictions, activities)
    - `messages` - Individual messages with citations and permits
    - `jurisdictions` - Reference data (federal, state, county, municipal)
    - `sources` - Data source freshness tracking
    - `feedback` - User ratings and comments
  - Schema: `convex/schema.ts` (defined with Convex schema API)
  - Type generation: Auto-generated TypeScript types in `convex/_generated/api.ts`

**Vector Database:**
- **Pinecone** - Managed vector database
  - Index: `compliance-iq-prod`
  - Dimensions: 3072 (text-embedding-3-large)
  - Metric: Cosine similarity
  - Cloud: AWS (us-east-1)
  - Metadata fields (indexed):
    - `jurisdiction_id` - Filter by specific jurisdiction
    - `jurisdiction_type` - Filter by level (federal/state/county/municipal)
    - `source_type` - statute, regulation, ordinance, guidance
    - `activity_tags` - Business activity categories
    - `effective_date` - Temporal filtering
  - Usage: Called from Convex actions during query execution

## Authentication & Identity

**Auth Provider:**
- **Clerk** - Primary authentication provider
  - Implementation: OAuth 2.0 / Session-based
  - Frontend: `@clerk/clerk-react` with `<ClerkProvider>` wrapper
  - Backend: Convex helper functions in `convex/lib/auth.ts`
  - User model:
    - `clerkId` - Unique Clerk user ID
    - `email` - Email address
    - `name` - Display name
    - `organization` - Organization (e.g., "Costco Wholesale")
    - `role` - Role-based access (compliance, operations, legal, admin)
  - Indexes: `by_clerk_id`, `by_email`, `by_org`

**API Key Authentication (External REST API):**
- Custom API key validation in Cloudflare Workers
- Header: `X-API-Key` for external calls
- Validation: `workers/external-api/src/middleware/auth.ts`
- Keys stored in Cloudflare secrets

## Monitoring & Observability

**Error Tracking:**
- Not yet specified (candidates: Sentry, Axiom, LogRocket for frontend)
- Backend errors logged via Convex built-in logging

**Logs:**
- **Convex**: Automatic request/function logs available in dashboard
- **Cloudflare**: Worker logs via `wrangler tail` or Cloudflare dashboard
- **Pipeline**: Ingestion logs written to R2 at `/logs/ingestion/`
- **Application**: Messages table tracks status changes (pending → processing → streaming → complete/error)

## CI/CD & Deployment

**Hosting:**
- **Frontend**: Deploy to Cloudflare Pages (automatic from git)
  - Build command: `npm run build`
  - Publish directory: `dist/`
- **Convex**: Hosted at convex.cloud (no self-hosting)
  - Deploy: `npx convex deploy` (CI/CD integrated)
- **Cloudflare Workers**: Workers KV, R2, Queues hosted on Cloudflare edge
  - Deploy: `wrangler publish` (from CLI or CI)
- **Database**: Convex managed
- **Vector DB**: Pinecone managed

**CI Pipeline:**
- Not yet configured (recommend: GitHub Actions)
- Expected flow:
  1. Lint + test on PR
  2. Deploy preview to Cloudflare Pages
  3. Deploy to production on main branch merge

## Environment Configuration

**Required Environment Variables (Convex):**
Set via `npx convex env set`:
```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
PINECONE_INDEX=compliance-iq-prod
PINECONE_ENVIRONMENT=us-east-1
MAPBOX_ACCESS_TOKEN=pk...
CLERK_SECRET_KEY=sk_...
```

**Required Environment Variables (Cloudflare/wrangler.toml):**
```
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
PINECONE_INDEX=compliance-iq-prod
FIRECRAWL_API_KEY=fc-...
CONVEX_URL=https://your-project.convex.cloud
CONVEX_DEPLOY_KEY=...
# Optional for P1:
LEGISCAN_API_KEY=...
```

**Required Environment Variables (Frontend/.env.local):**
```
VITE_CONVEX_URL=https://your-project.convex.cloud
VITE_CLERK_KEY=pk_...
```

**Secrets Location:**
- Convex secrets: Convex dashboard → Settings → Environment Variables
- Cloudflare secrets: Wrangler CLI or Cloudflare dashboard
- Frontend: `.env.local` (gitignored, not committed)

## Webhooks & Callbacks

**Incoming Webhooks:**
- Clerk webhooks (optional) - User lifecycle events (create, update, delete)
  - Could be used for user syncing, but MVP relies on Clerk ID lookup
- Pinecone webhooks - Not typically used (polling-based)

**Outgoing Webhooks:**
- Cloudflare Queue consumers trigger Convex HTTP Actions via direct HTTP calls
- Sync worker (`workers/sync-worker/`) calls Convex mutations to update source metadata
- No external webhook notifications planned for MVP

## Data Flow Summary

```
PHASE 1 - DATA PIPELINE (Current Focus):

External Sources (eCFR API, Texas Statutes, Municode, etc.)
  ↓
Firecrawl API (JS rendering → clean Markdown)
  ↓
Cloudflare Workers (Ingestion orchestration)
  ↓
Cloudflare R2 (Raw Markdown documents)
  ↓
Cloudflare Queues (Processing pipeline)
  ↓
OpenAI Embeddings API (text-embedding-3-large)
  ↓
Pinecone (Vector storage with metadata)
  ↓
Convex Sync Worker (Metadata updates)
  ↓
Convex Database (Source freshness tracking)

PHASE 1 - QUERY TESTING (via HTTP API):

curl/Postman
  ↓
Convex HTTP Action (query endpoint)
  ├→ Mapbox (Address → Jurisdiction)
  ├→ Pinecone (Vector Search)
  └→ Claude API (LLM Response)
  ↓
JSON Response

PHASE 2 - FRONTEND (Later):

React App (Convex SDK)
  ↓
Convex Action (Orchestration)
  ↓
Real-time Message Stream to React
```

---

*Integration audit: 2026-01-31*
*Updated: 2026-01-31 — Firecrawl replaces Browserless.io, Phase 1/2 split*
