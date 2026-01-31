# Technology Stack

**Analysis Date:** 2026-01-31
**Last Updated:** 2026-01-31

## Languages

**Primary:**
- **TypeScript** - Frontend (React), Convex backend, Cloudflare Workers, all application code
- **HTML/CSS** - Frontend UI components with Tailwind CSS

**Secondary:**
- **JavaScript/Node.js** - Runtime for Cloudflare Workers, supporting tools

## Runtime

**Environment:**
- **Node.js** - Backend runtime for Cloudflare Workers and development
- **Cloudflare Workers** - Serverless compute for data pipeline and external API
- **Convex** - Serverless application backend (TypeScript runtime)

**Package Manager:**
- **npm** (recommended) or **yarn**
- Lockfile: Expected (package-lock.json or yarn.lock)

## Frameworks

**Core Application:**
- **Convex** (https://convex.dev) - Real-time serverless backend with TypeScript schema, queries, mutations, and actions
- **React** - Frontend UI for chat and compliance dashboard
- **Clerk** - User authentication and session management

**Supporting:**
- **Tailwind CSS** - Frontend styling and component system
- **Hono.js** - Router/framework for Cloudflare Workers REST API layer

**Testing:**
- Not yet established (recommend Jest or Vitest for React/TypeScript)

**Build/Dev:**
- **Vite** - Frontend build tool (recommended for React + TypeScript)
- **Wrangler** - Cloudflare Workers development and deployment CLI
- **Convex CLI** - Convex project management and code generation

## Key Dependencies

**Phase 1 - Data Pipeline (Critical):**
- **convex** - Backend framework and SDK
- **pinecone-client** - Vector database client for regulatory embeddings
- **anthropic** - Claude LLM API client (Anthropic)
- **openai** - Embeddings API (text-embedding-3-large)
- **mapbox-gl** / **@mapbox/mapbox-sdk** - Geocoding and address resolution

**Phase 1 - Infrastructure:**
- **hono** - Lightweight routing for Cloudflare Workers REST API
- **wrangler** - Cloudflare toolchain
- **cloudflare-queues** - Message queue system (via Wrangler bindings)
- **r2-client** (via Wrangler R2 bindings) - Object storage on Cloudflare R2
- **firecrawl** - Web scraping API with JS rendering, returns clean Markdown (replaces Browserless.io)
- **cheerio** - Static HTML parsing for federal API XML/HTML responses
- **tesseract.js** or **@azure/ai-document-intelligence** - OCR for PDF processing (if needed)

**Phase 2 - Frontend (Deferred):**
- **react** - UI framework
- **@clerk/clerk-react** - Auth integration with Clerk
- **@clerk/backend** - Server-side Clerk operations
- **recharts** or **chart.js** - Dashboard visualization (optional)
- **zustand** or **jotai** - Client state management (minimal, since Convex handles it)

## Configuration

**Environment:**
- Variables managed via Convex dashboard (`npx convex env set`)
- Cloudflare secrets via `wrangler.toml` or dashboard
- Frontend env vars via `.env` files (`VITE_CONVEX_URL`, `VITE_CLERK_KEY`, etc.)

**Key Configuration Required (Phase 1 - Backend):**
- `CONVEX_URL` - Convex deployment URL
- `ANTHROPIC_API_KEY` - Claude API access
- `OPENAI_API_KEY` - OpenAI embeddings
- `PINECONE_API_KEY` / `PINECONE_INDEX` - Vector database
- `MAPBOX_ACCESS_TOKEN` - Geocoding service
- `FIRECRAWL_API_KEY` - Web scraping service (replaces Browserless)
- `LEGISCAN_API_KEY` - Bill tracking (P1, optional for MVP)

**Key Configuration Required (Phase 2 - Frontend):**
- `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` - Clerk auth
- `VITE_CONVEX_URL` - Frontend Convex endpoint
- `VITE_CLERK_KEY` - Frontend Clerk key

**Build:**
- `tsconfig.json` - TypeScript configuration (root and per-package)
- `vite.config.ts` - Frontend build configuration
- `wrangler.toml` - Cloudflare Workers configuration (includes R2, Queues, secrets bindings)
- `.prettierrc` - Code formatting (enforce consistency)
- `.eslintrc` or similar - Linting rules

## Platform Requirements

**Development:**
- Node.js 18+ (LTS recommended)
- npm or yarn
- Cloudflare account (free tier sufficient for MVP)
- Convex account (free tier includes unlimited storage, 1M queries/mo)
- Pinecone account (starter tier ~$70/mo)
- Anthropic API key (Claude usage-based)
- OpenAI API key (embeddings usage-based)
- Mapbox account (free tier 100K requests/mo)
- Clerk account (free tier 10K MAU)

**Production:**
- **Deployment Target:** Cloudflare Workers (global edge network)
- **Convex:** Hosted (https://convex.cloud)
- **Pinecone:** Managed (us-east-1 or region of choice)
- **R2:** Cloudflare object storage
- **Database:** Convex-managed backend (no separate DB needed for application layer)

## Development Stack Details

**React Project Structure:**
- `src/` - Frontend React components and logic
- `src/components/` - Reusable UI components
- `public/` - Static assets

**Convex Project Structure:**
- `convex/` - All backend code
- `convex/schema.ts` - Data model and table definitions
- `convex/queries.ts` - Real-time queries
- `convex/mutations.ts` - Write operations
- `convex/actions.ts` - External API calls (Pinecone, Claude, Mapbox, OpenAI)
- `convex/http.ts` - HTTP endpoints for external REST API
- `convex/_generated/` - Auto-generated types and client (not edited manually)

**Cloudflare Workers Structure:**
- `workers/ingestion-api/` - Federal API-based ingestion
- `workers/ingestion-scraper/` - HTML/JavaScript scraping (Browserless.io)
- `workers/embedding-worker/` - Queue consumer for embeddings
- `workers/sync-worker/` - Metadata sync to Convex
- `workers/external-api/` - REST API for external consumers
- `workers/scheduled/` - Cron-triggered jobs

## Cost Model (Monthly)

### Phase 1 - Backend/Data Pipeline Only

| Service | Usage | Cost | Notes |
|---------|-------|------|-------|
| **Convex** | Free tier | $0 | Free tier sufficient for backend-only |
| **Cloudflare Workers** | 1M requests | ~$5 | Lower volume without frontend |
| **Cloudflare R2** | 20GB storage, 1M requests | ~$5 | Regulatory docs + logs |
| **Cloudflare Queues** | 500K messages | ~$3 | Ingestion pipeline |
| **Pinecone** | Starter tier | $0-$70 | Free tier may suffice for Texas pilot |
| **Anthropic Claude** | ~100 test queries/day | ~$100 | Testing only, no production traffic |
| **OpenAI Embeddings** | ~5M tokens/mo | ~$7 | Initial corpus embedding |
| **Mapbox Geocoding** | 10K requests | $0 | Free tier sufficient |
| **Firecrawl** | 3K pages/mo | $0-$16 | Free tier: 500 pages, Starter: $16/mo |
| **Total Phase 1 (Monthly)** | | **~$120-200** | Much lower without production LLM traffic |

### Phase 2 - With Frontend (Later)

| Service | Usage | Cost | Notes |
|---------|-------|------|-------|
| **Clerk** | Free tier 10K MAU | $0 | No charges expected |
| **Anthropic Claude** | ~500 queries/day production | ~$1,500 | Scales with usage (LLM-dominant cost) |
| **Total Phase 2 (Monthly)** | | **~$1,600-2,000** | Dominated by Claude costs |

---

*Stack analysis: 2026-01-31*
*Updated: 2026-01-31 — Firecrawl replaces Browserless, Phase 1/2 cost split*
