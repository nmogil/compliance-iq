# ComplianceIQ Codebase Structure Options

## Overview

This document presents three codebase configuration options for the ComplianceIQ project, which uses a hybrid architecture:

- **Convex** — Application layer (chat, auth, query orchestration)
- **Cloudflare Workers** — Data pipeline (scraping, ingestion, embedding)
- **React** — Frontend
- **Pinecone** — Vector database (external service)

---

## Option 1: Monorepo with pnpm Workspaces (⭐ RECOMMENDED)

A single repository using pnpm workspaces for package management. All code lives together but is organized into distinct packages.

```
compliance-iq/
├── package.json                    # Root package.json with workspaces
├── pnpm-workspace.yaml             # Workspace configuration
├── turbo.json                      # Turborepo config (optional, for caching)
├── .github/
│   └── workflows/
│       ├── deploy-convex.yml       # Convex deployment
│       ├── deploy-workers.yml      # Cloudflare Workers deployment
│       └── deploy-frontend.yml     # Frontend deployment (Vercel/Cloudflare Pages)
│
├── apps/
│   ├── web/                        # React frontend
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── src/
│   │   │   ├── main.tsx
│   │   │   ├── App.tsx
│   │   │   ├── components/
│   │   │   │   ├── chat/
│   │   │   │   │   ├── ChatInterface.tsx
│   │   │   │   │   ├── MessageList.tsx
│   │   │   │   │   ├── MessageInput.tsx
│   │   │   │   │   └── Citation.tsx
│   │   │   │   ├── dashboard/
│   │   │   │   │   ├── ComplianceDashboard.tsx
│   │   │   │   │   └── JurisdictionMap.tsx
│   │   │   │   └── ui/
│   │   │   │       └── ... (shared UI components)
│   │   │   ├── hooks/
│   │   │   │   ├── useConversations.ts
│   │   │   │   └── useCompliance.ts
│   │   │   └── lib/
│   │   │       └── utils.ts
│   │   └── public/
│   │
│   └── convex/                     # Convex backend (application layer)
│       ├── package.json
│       ├── convex.json
│       ├── schema.ts               # Database schema
│       ├── _generated/             # Auto-generated types
│       ├── functions/
│       │   ├── conversations.ts    # Conversation queries/mutations
│       │   ├── messages.ts         # Message queries/mutations
│       │   ├── jurisdictions.ts    # Jurisdiction queries
│       │   └── feedback.ts         # User feedback
│       ├── actions/
│       │   ├── query.ts            # Main RAG query action
│       │   ├── geocode.ts          # Mapbox geocoding
│       │   ├── pinecone.ts         # Vector search
│       │   └── claude.ts           # LLM calls
│       ├── http.ts                 # HTTP actions for external API
│       └── lib/
│           ├── embeddings.ts       # Embedding utilities
│           └── citations.ts        # Citation parsing
│
├── workers/                        # Cloudflare Workers (data pipeline)
│   ├── ingestion-api/              # Federal API ingestion
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   ├── index.ts            # Worker entry point
│   │   │   ├── sources/
│   │   │   │   └── ecfr.ts         # eCFR API client
│   │   │   └── lib/
│   │   │       └── r2.ts           # R2 storage helpers
│   │   └── tsconfig.json
│   │
│   ├── ingestion-scraper/          # HTML scraping (state/local)
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── scrapers/
│   │   │   │   ├── texas-statutes.ts
│   │   │   │   ├── texas-admin-code.ts
│   │   │   │   ├── municode.ts
│   │   │   │   └── american-legal.ts
│   │   │   └── lib/
│   │   │       └── browserless.ts  # Browserless.io client
│   │   └── tsconfig.json
│   │
│   ├── embedding/                  # Chunk & embed pipeline
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   ├── src/
│   │   │   ├── index.ts            # Queue consumer
│   │   │   └── lib/
│   │   │       ├── chunker.ts      # Text chunking
│   │   │       ├── openai.ts       # Embedding API
│   │   │       └── pinecone.ts     # Vector upsert
│   │   └── tsconfig.json
│   │
│   ├── sync/                       # Sync metadata to Convex
│   │   ├── package.json
│   │   ├── wrangler.toml
│   │   └── src/
│   │       └── index.ts
│   │
│   └── scheduled/                  # Cron triggers
│       ├── package.json
│       ├── wrangler.toml
│       └── src/
│           └── index.ts
│
├── packages/                       # Shared packages
│   ├── types/                      # Shared TypeScript types
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── jurisdiction.ts
│   │       ├── source.ts
│   │       ├── chunk.ts
│   │       └── citation.ts
│   │
│   ├── shared/                     # Shared utilities
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── citations.ts        # Citation normalization
│   │       └── jurisdictions.ts    # Jurisdiction matching
│   │
│   └── config/                     # Shared configuration
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── jurisdictions.ts    # Jurisdiction definitions
│           └── activities.ts       # Business activity categories
│
├── scripts/                        # Development & deployment scripts
│   ├── seed-jurisdictions.ts       # Seed Convex with jurisdiction data
│   ├── test-ecfr.ts               # Test eCFR API
│   └── validate-pinecone.ts       # Validate Pinecone index
│
└── docs/                          # Documentation (separate from planning)
    ├── api.md
    └── deployment.md
```

### Root package.json

```json
{
  "name": "compliance-iq",
  "private": true,
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "deploy:convex": "cd apps/convex && npx convex deploy",
    "deploy:workers": "turbo run deploy --filter='./workers/*'",
    "deploy:web": "turbo run build --filter=web && vercel --prod"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.0.0"
  }
}
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'workers/*'
  - 'packages/*'
```

### Pros
- ✅ Single source of truth — all code in one place
- ✅ Shared types between frontend, Convex, and Workers
- ✅ Easy cross-package refactoring
- ✅ Single PR for coordinated changes
- ✅ Turborepo caching speeds up builds
- ✅ pnpm is fast and efficient with disk space

### Cons
- ❌ Larger clone size
- ❌ CI/CD complexity (need to detect which packages changed)
- ❌ Learning curve for monorepo tooling

---

## Option 2: Polyrepo (Separate Repositories)

Each major component lives in its own repository.

```
github.com/your-org/
├── compliance-iq-web/              # React frontend
│   ├── package.json
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── lib/
│   └── ...
│
├── compliance-iq-convex/           # Convex backend
│   ├── package.json
│   ├── convex/
│   │   ├── schema.ts
│   │   ├── functions/
│   │   └── actions/
│   └── ...
│
├── compliance-iq-workers/          # All Cloudflare Workers
│   ├── package.json
│   ├── workers/
│   │   ├── ingestion-api/
│   │   ├── ingestion-scraper/
│   │   ├── embedding/
│   │   └── sync/
│   └── ...
│
└── compliance-iq-types/            # Shared types (npm package)
    ├── package.json
    └── src/
        └── ...
```

### Pros
- ✅ Independent deployments
- ✅ Clear ownership boundaries
- ✅ Simpler CI/CD per repo
- ✅ Can use different Node versions per repo

### Cons
- ❌ Shared types require publishing npm package
- ❌ Coordinated changes require multiple PRs
- ❌ Version drift between repos
- ❌ More repos to manage

---

## Option 3: Hybrid (Convex+Frontend together, Workers separate)

Frontend and Convex share a repo (they're tightly coupled), Workers are separate.

```
github.com/your-org/
├── compliance-iq-app/              # Frontend + Convex
│   ├── package.json
│   ├── convex/
│   │   ├── schema.ts
│   │   ├── functions/
│   │   └── actions/
│   ├── src/                        # React app
│   │   ├── components/
│   │   └── ...
│   └── shared/                     # Shared types/utils
│       └── types/
│
└── compliance-iq-pipeline/         # All Cloudflare Workers
    ├── package.json
    ├── pnpm-workspace.yaml
    ├── workers/
    │   ├── ingestion-api/
    │   ├── ingestion-scraper/
    │   ├── embedding/
    │   └── sync/
    └── packages/
        └── shared/                 # Pipeline-specific shared code
```

### Pros
- ✅ Keeps tightly-coupled code together (frontend + Convex)
- ✅ Pipeline can evolve independently
- ✅ Simpler than full monorepo

### Cons
- ❌ Types shared between app and pipeline need duplication or npm package
- ❌ Two repos to manage
- ❌ Coordinated schema changes still require sync

---

## Recommendation: Option 1 (Monorepo)

**For ComplianceIQ, I strongly recommend Option 1 (Monorepo with pnpm workspaces)** for these reasons:

### 1. Tight Coupling Between Components

Your architecture has significant coupling:
- Frontend uses Convex SDK with auto-generated types
- Convex actions call Pinecone with specific metadata schemas
- Workers write to Pinecone with the same metadata schemas
- Workers sync to Convex, requiring shared type definitions

A monorepo keeps these in sync naturally.

### 2. Shared Types Are Critical

The `chunk.ts` metadata schema must match between:
- `workers/embedding/` (writes to Pinecone)
- `apps/convex/actions/pinecone.ts` (reads from Pinecone)

In a monorepo, both import from `packages/types/chunk.ts`. In a polyrepo, you need to publish and version an npm package.

### 3. Small Team / Early Stage

For a small team building an MVP, the overhead of managing multiple repos and npm packages outweighs the benefits. Monorepo lets you move fast.

### 4. Deployment Independence Still Possible

Even in a monorepo:
- Convex deploys independently via `npx convex deploy`
- Each Worker deploys independently via `wrangler deploy`
- Frontend deploys independently to Vercel/Cloudflare Pages

CI/CD can detect which packages changed and only deploy affected services.

---

## Implementation: Getting Started with Option 1

### Step 1: Initialize the monorepo

```bash
mkdir compliance-iq && cd compliance-iq
pnpm init
```

### Step 2: Configure workspaces

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'workers/*'
  - 'packages/*'
```

### Step 3: Create the structure

```bash
mkdir -p apps/web apps/convex
mkdir -p workers/ingestion-api workers/ingestion-scraper workers/embedding workers/sync workers/scheduled
mkdir -p packages/types packages/shared packages/config
mkdir -p scripts docs
```

### Step 4: Initialize each package

```bash
# Frontend
cd apps/web && pnpm create vite . --template react-ts

# Convex
cd apps/convex && npx convex init

# Workers (repeat for each)
cd workers/ingestion-api && pnpm init && pnpm add -D wrangler
```

### Step 5: Set up shared types

```typescript
// packages/types/src/chunk.ts
export interface ChunkMetadata {
  jurisdiction_id: string;
  jurisdiction_type: 'federal' | 'state' | 'county' | 'municipal';
  source_type: 'statute' | 'regulation' | 'ordinance' | 'guidance';
  citation: string;
  citation_normalized: string;
  section_title: string;
  activity_tags: string[];
  effective_date: string;
  source_url: string;
  last_updated: string;
}

export interface ChunkVector {
  id: string;
  values: number[];
  metadata: ChunkMetadata;
}
```

### Step 6: Reference shared packages

```json
// workers/embedding/package.json
{
  "name": "@compliance-iq/embedding-worker",
  "dependencies": {
    "@compliance-iq/types": "workspace:*",
    "@compliance-iq/shared": "workspace:*"
  }
}
```

---

## Alternative: Turborepo (Optional Enhancement)

Add Turborepo for faster builds with caching:

```bash
pnpm add -D turbo
```

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "deploy": {
      "dependsOn": ["build"]
    }
  }
}
```

This is optional for MVP but helpful as the codebase grows.

---

## Summary

| Aspect | Option 1 (Monorepo) | Option 2 (Polyrepo) | Option 3 (Hybrid) |
|--------|---------------------|---------------------|-------------------|
| Type sharing | ✅ Easy | ❌ Requires npm pkg | ⚠️ Partial |
| Coordinated changes | ✅ Single PR | ❌ Multiple PRs | ⚠️ Sometimes |
| Independent deploys | ✅ Yes | ✅ Yes | ✅ Yes |
| Setup complexity | ⚠️ Medium | ✅ Low | ⚠️ Medium |
| Long-term maintainability | ✅ High | ⚠️ Medium | ⚠️ Medium |
| **Recommended for ComplianceIQ** | ⭐ **YES** | No | Maybe |

---

*Document version: 0.1*
*Last updated: January 31, 2026*
