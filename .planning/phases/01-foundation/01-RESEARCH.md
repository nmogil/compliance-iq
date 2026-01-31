# Phase 1: Foundation - Research

**Researched:** 2026-01-31
**Domain:** Monorepo infrastructure with pnpm workspaces, Convex backend, Cloudflare Workers, Pinecone vector DB, React frontend
**Confidence:** HIGH

## Summary

Phase 1 establishes a modern TypeScript monorepo using pnpm workspaces to house three primary components: a Convex backend for real-time data, Cloudflare Workers for batch processing with R2 storage, and a React frontend with Tailwind CSS. The architecture leverages workspace protocols for type sharing, enabling end-to-end type safety across all packages.

The standard approach uses pnpm's workspace protocol for internal dependencies, Vite for frontend tooling, wrangler for Cloudflare deployment, and Vitest for testing. All components are TypeScript-first with generated types from Convex schemas and wrangler configurations providing compile-time safety.

Critical success factors include proper workspace configuration for live TypeScript types across packages, serverless Pinecone index setup with 3072 dimensions for custom embeddings, and CI/CD with selective testing based on changed packages.

**Primary recommendation:** Use pnpm workspaces with `workspace:*` protocol, organize as `apps/` and `packages/` directories, share types via custom export conditions for zero-build development, and leverage Turborepo or Nx for selective CI/CD execution.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pnpm | 10.x | Package manager with workspace support | Native monorepo support, 60-80% less disk usage, content-addressable storage prevents phantom dependencies |
| TypeScript | 5.0.3+ | Type system | Required by Convex, Cloudflare Workers, enables end-to-end type safety |
| Convex | Latest | Real-time backend/database | Auto-generates TypeScript types from schemas, reactive queries, managed infrastructure |
| Cloudflare Workers | Latest | Serverless compute for batch jobs | Edge deployment, R2 integration, TypeScript-first with wrangler types |
| Pinecone | 6.1.3+ | Vector database | Managed vector search, serverless scaling, cosine similarity for embeddings |
| React | 18.x | Frontend framework | Industry standard, Convex React hooks provide reactivity |
| Vite | 5.x+ | Frontend build tool | Fast HMR, native ESM, TypeScript support, Tailwind plugin |
| Tailwind CSS | 4.x | Styling framework | Utility-first, Vite plugin (`@tailwindcss/vite`), no PostCSS config needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | Latest | Testing framework | Monorepo testing with projects config, fast parallel execution |
| ESLint | Latest | Linting | Code quality, use shared config package in monorepo |
| Prettier | Latest | Code formatting | Consistency, integrate via `eslint-plugin-prettier` |
| Turborepo or Nx | Latest | Build orchestration | Selective task execution based on git changes, remote caching |
| @pinecone-database/pinecone | 6.1.3+ | Pinecone TypeScript SDK | Server-side vector operations, requires Node >= 18.x |
| @cloudflare/workers-types | Latest (if needed) | Cloudflare types | Fallback if `wrangler types` insufficient, but prefer generated types |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| pnpm | npm workspaces, yarn | pnpm is faster, stricter, prevents phantom deps |
| Vite | Next.js | Vite for SPA simplicity, Next.js if need SSR/routing (not required for MVP) |
| Turborepo | Nx | Turborepo simpler for builds, Nx more features but steeper learning curve |
| Tailwind 4.x | Tailwind 3.x | v4 uses Vite plugin, simpler setup, no `tailwind.config.js` needed |

**Installation:**
```bash
# Root
npm install -g pnpm@latest corepack@latest
corepack enable
corepack prepare pnpm@latest-10 --activate

# Dependencies (managed per workspace)
pnpm install convex
pnpm install @pinecone-database/pinecone
pnpm install wrangler --save-dev
pnpm install -D vitest @vitejs/plugin-react
```

## Architecture Patterns

### Recommended Project Structure
```
compliance-iq/
├── apps/
│   ├── web/                    # React frontend (Vite + Tailwind)
│   ├── convex/                 # Convex backend (schema, queries, mutations)
│   └── workers/                # Cloudflare Workers (batch jobs, R2)
├── packages/
│   ├── shared-types/           # Shared TypeScript types
│   ├── eslint-config/          # Shared ESLint configuration
│   └── tsconfig/               # Shared TypeScript configs
├── pnpm-workspace.yaml
├── package.json
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions for CI/CD
└── README.md
```

### Pattern 1: Workspace Protocol for Type Sharing
**What:** Use `workspace:*` protocol to reference internal packages, ensuring local resolution during development and semver replacement on publish.

**When to use:** All internal dependencies between apps and packages.

**Example:**
```typescript
// packages/shared-types/package.json
{
  "name": "@compliance-iq/shared-types",
  "version": "0.1.0",
  "exports": {
    "./*": {
      "import": {
        "@compliance-iq/source": "./src/*.ts",
        "default": "./dist/*.js",
        "types": "./dist/*.d.ts"
      }
    }
  }
}

// apps/web/package.json
{
  "name": "@compliance-iq/web",
  "dependencies": {
    "@compliance-iq/shared-types": "workspace:*"
  }
}

// apps/web/tsconfig.json (extends base)
{
  "extends": "@compliance-iq/tsconfig/base.json",
  "compilerOptions": {
    "customConditions": ["@compliance-iq/source"]
  }
}
```
**Source:** [pnpm workspaces](https://pnpm.io/workspaces), [Live Types in Monorepo](https://colinhacks.com/essays/live-types-typescript-monorepo)

### Pattern 2: Convex Schema with TypeScript Generation
**What:** Define schema in `convex/schema.ts`, run `npx convex dev` to generate types in `_generated/`, import `api` and `Doc` types in both backend and frontend.

**When to use:** All Convex table definitions. Start without schema for prototyping, add once solidified.

**Example:**
```typescript
// apps/convex/convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  jurisdictions: defineTable({
    name: v.string(),
    type: v.union(v.literal("federal"), v.literal("state")),
    state_code: v.optional(v.string()),
  }),
  sources: defineTable({
    jurisdiction_id: v.id("jurisdictions"),
    name: v.string(),
    url: v.string(),
    last_scraped_at: v.optional(v.number()),
  }),
  conversations: defineTable({
    user_id: v.string(),
    created_at: v.number(),
  }),
  messages: defineTable({
    conversation_id: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    created_at: v.number(),
  }),
});

// Generated types available at:
// apps/convex/convex/_generated/dataModel.d.ts
// Import as: import { Doc, Id } from "../convex/_generated/dataModel";
```
**Source:** [Convex Schemas](https://docs.convex.dev/database/schemas)

### Pattern 3: Cloudflare Workers with R2 Bindings
**What:** Use `wrangler types` to generate TypeScript bindings from `wrangler.jsonc`, access R2 bucket via `env.MY_BUCKET`.

**When to use:** All Cloudflare Workers with R2, KV, or D1 bindings.

**Example:**
```typescript
// apps/workers/wrangler.jsonc
{
  "name": "compliance-iq-worker",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-31",
  "r2_buckets": [
    {
      "binding": "DOCUMENTS_BUCKET",
      "bucket_name": "compliance-documents"
    }
  ]
}

// Generate types (run before build)
// npx wrangler types

// apps/workers/src/index.ts
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // TypeScript knows env.DOCUMENTS_BUCKET exists and its type
    const object = await env.DOCUMENTS_BUCKET.get("key");
    return new Response(object?.body);
  }
};
```
**Source:** [Cloudflare Workers TypeScript](https://developers.cloudflare.com/workers/languages/typescript/), [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)

### Pattern 4: Pinecone Serverless Index Creation
**What:** Initialize Pinecone client with API key, create serverless index with explicit dimension and metric.

**When to use:** Initial setup for vector storage. Use serverless spec for auto-scaling.

**Example:**
```typescript
// apps/workers/src/setup-pinecone.ts
import { Pinecone } from '@pinecone-database/pinecone';

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

await pc.createIndex({
  name: 'compliance-embeddings',
  dimension: 3072,
  metric: 'cosine',
  spec: {
    serverless: {
      cloud: 'aws',
      region: 'us-east-1',
    },
  },
  waitUntilReady: true,
});
```
**Source:** [Pinecone TypeScript SDK](https://sdk.pinecone.io/typescript/)

### Pattern 5: React with Convex Provider
**What:** Wrap React app with `ConvexProvider`, use `useQuery` and `useMutation` hooks with generated `api` object.

**When to use:** All Convex data access in React components.

**Example:**
```typescript
// apps/web/src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>
);

// apps/web/src/App.tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/convex/_generated/api";

export default function App() {
  const jurisdictions = useQuery(api.jurisdictions.list);
  const addJurisdiction = useMutation(api.jurisdictions.add);

  return <div className="text-3xl font-bold underline">
    {jurisdictions?.map(j => <div key={j._id}>{j.name}</div>)}
  </div>;
}
```
**Source:** [Convex React](https://docs.convex.dev/client/react)

### Pattern 6: Vite + Tailwind 4.x Setup
**What:** Use `@tailwindcss/vite` plugin in `vite.config.ts`, import `@import "tailwindcss"` in CSS.

**When to use:** React apps with Tailwind CSS v4+.

**Example:**
```typescript
// apps/web/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});

// apps/web/src/index.css
@import "tailwindcss";
```
**Source:** [Tailwind CSS with React Router](https://tailwindcss.com/docs/installation/framework-guides/react-router)

### Pattern 7: Monorepo CI/CD with Selective Execution
**What:** Use `pnpm/action-setup@v4` with `actions/setup-node@v4` (cache: pnpm), run tests only for changed packages using filters or Turborepo.

**When to use:** GitHub Actions workflows for monorepo.

**Example:**
```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install
      - run: pnpm run build
      - run: pnpm run test
      - run: pnpm run lint
```
**Source:** [pnpm CI](https://pnpm.io/continuous-integration), [GitHub Actions Monorepo 2026](https://dev.to/pockit_tools/github-actions-in-2026-the-complete-guide-to-monorepo-cicd-and-self-hosted-runners-1jop)

### Anti-Patterns to Avoid
- **Installing dependencies at root level:** Keep shared devDependencies at root, but app-specific deps in app package.json
- **Not using workspace protocol:** Using `file:` or `link:` is fragile; always use `workspace:*`
- **Skipping wrangler types generation:** Manual type definitions get stale; always run `wrangler types` before build
- **Using Tailwind 3.x PostCSS config:** Tailwind 4.x uses Vite plugin; don't create `tailwind.config.js` or `postcss.config.js`
- **Manual Convex type definitions:** Never manually type `Doc<"table">`; always import from `_generated/dataModel`

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Monorepo task orchestration | Shell scripts with `cd` and `&&` | Turborepo or Nx | Handles change detection, caching, parallel execution, and dependency graphs |
| TypeScript project references | Manual `tsconfig.json` inheritance | Shared `@compliance-iq/tsconfig` package | Centralized config, ensures consistency, easier updates |
| ESLint/Prettier config | Copy-paste into each package | Shared `@compliance-iq/eslint-config` package | Single source of truth, automatic updates |
| Environment variable management | `.env` files scattered everywhere | Convex env vars + Cloudflare secrets | Type-safe, platform-native, no secrets in git |
| Vector similarity search | Custom cosine similarity implementation | Pinecone | Handles indexing, scaling, metadata filtering, approximate nearest neighbor |
| Build caching | Custom hash-based cache | Turborepo remote cache or GitHub Actions cache | Built-in, proven, handles cache invalidation |

**Key insight:** Monorepo tooling is complex. The "simple" task runner scripts break with circular dependencies, partial builds, and selective testing. Use battle-tested tools that handle the graph problem correctly.

## Common Pitfalls

### Pitfall 1: Tightly Coupled Packages Without Clear Boundaries
**What goes wrong:** Apps directly import from other apps, creating circular dependencies and tight coupling.

**Why it happens:** Convenience during rapid development; importing `apps/web/src/utils` from `apps/workers` seems easy.

**How to avoid:**
- Enforce rule: apps never import from other apps
- Shared code goes in `packages/`
- Use ESLint `no-restricted-imports` to block cross-app imports

**Warning signs:**
- Build errors about circular dependencies
- Changes in one app unexpectedly break another
- Can't deploy apps independently

### Pitfall 2: Phantom Dependencies (Not Using pnpm Strict)
**What goes wrong:** Code imports packages not declared in package.json, works locally due to hoisting, fails in CI or production.

**Why it happens:** pnpm hoists some dependencies by default; package A imports from package B's dependencies without declaring them.

**How to avoid:**
- Verify `pnpm-workspace.yaml` exists at root
- Never set `shamefully-hoist=true` in `.npmrc`
- Run `pnpm install --frozen-lockfile` in CI

**Warning signs:**
- "Cannot find module" errors in CI but not locally
- Different behavior between `pnpm install` and `pnpm install --frozen-lockfile`

### Pitfall 3: Not Committing Generated Types
**What goes wrong:** Convex `_generated/` or wrangler `worker-configuration.d.ts` ignored in git, breaking CI and teammate setups.

**Why it happens:** Assumption that generated files shouldn't be committed.

**How to avoid:**
- Commit Convex `_generated/` directory
- Commit wrangler `worker-configuration.d.ts`
- Run generation in `prepare` script as backup
- Include type-check in CI before tests

**Warning signs:**
- Fresh clones fail type-checking
- CI shows TypeScript errors that don't appear locally
- `_generated` directory missing after git clone

### Pitfall 4: Missing Custom Conditions for Live Types
**What goes wrong:** Changes to shared packages require rebuilding before other packages see them, slowing development.

**Why it happens:** Default TypeScript resolves to `dist/*.js` instead of `src/*.ts` files.

**How to avoid:**
- Add custom export condition `@compliance-iq/source` pointing to `src/*.ts`
- Set `customConditions: ["@compliance-iq/source"]` in all tsconfig.json files
- Configure Vite/Vitest to use same conditions

**Warning signs:**
- Must run build to see type changes
- Hot reload doesn't pick up shared package edits
- Slow feedback loop during development

### Pitfall 5: Incorrect Pinecone Dimension for Embedding Model
**What goes wrong:** Creating index with wrong dimension causes upsert failures.

**Why it happens:** Confusion between different embedding model dimensions (1536 for OpenAI, 3072 for text-embedding-3-large, etc.).

**How to avoid:**
- Verify embedding model output dimensions before creating index
- Document dimension choice in schema/comments
- Pinecone dimension is immutable; can't change after creation

**Warning signs:**
- Upsert operations fail with "dimension mismatch" errors
- Must delete and recreate index

### Pitfall 6: Running All Tests on Every PR
**What goes wrong:** CI times grow linearly with monorepo size, slowing down all PRs.

**Why it happens:** Simple `pnpm run test` runs all package tests regardless of changes.

**How to avoid:**
- Use Turborepo `--filter='...[origin/main]'` to test only changed packages and dependents
- Or use `dorny/paths-filter@v3` in GitHub Actions to detect changed workspaces
- Set up remote caching to share test results

**Warning signs:**
- CI taking >10 minutes for trivial changes
- Developers avoiding running full test suite locally
- Test times increasing with each new package

### Pitfall 7: Cloudflare Workers Bundle Size Bloat
**What goes wrong:** Importing large packages (like full AWS SDK) in Workers exceeds 1MB limit or causes slow cold starts.

**Why it happens:** Not tree-shaking properly, importing entire libraries instead of specific functions.

**How to avoid:**
- Import specific functions: `import { S3Client } from "@aws-sdk/client-s3"` not `import AWS from "aws-sdk"`
- Check bundle size with `wrangler deploy --dry-run`
- Use `wrangler.jsonl` `minify: true` for production

**Warning signs:**
- Wrangler warnings about bundle size
- Slow cold start times (>200ms)
- Deployment failures due to size limits

## Code Examples

Verified patterns from official sources:

### Monorepo Workspace Setup
```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```
**Source:** [pnpm workspaces](https://pnpm.io/workspaces)

### Convex Query and Mutation
```typescript
// apps/convex/convex/jurisdictions.ts
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("jurisdictions").collect();
  },
});

export const add = mutation({
  args: { name: v.string(), type: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.insert("jurisdictions", args);
  },
});
```
**Source:** [Convex Schemas](https://docs.convex.dev/database/schemas)

### Vitest Projects Config for Monorepo
```typescript
// vitest.workspace.ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*',
  'apps/*',
]);
```
**Source:** [Vitest Workspace](https://vitest.dev/guide/workspace)

### Shared ESLint Config Package
```json
// packages/eslint-config/package.json
{
  "name": "@compliance-iq/eslint-config",
  "version": "0.1.0",
  "main": "index.js",
  "dependencies": {
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint-config-prettier": "^9.0.0",
    "eslint-plugin-prettier": "^5.0.0"
  }
}

// packages/eslint-config/index.js
module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  parserOptions: {
    project: true,
  },
};
```
**Source:** [ESLint Monorepo Setup](https://gregory-gerard.dev/articles/eslint-in-a-monorepo)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tailwind with `tailwind.config.js` + PostCSS | Tailwind 4.x with `@tailwindcss/vite` plugin | Tailwind 4.0 (late 2024) | Simpler setup, faster builds, no PostCSS config |
| `@cloudflare/workers-types` package | `wrangler types` generation | wrangler 3.0+ (2023) | Types match exact runtime, includes bindings |
| Vitest workspace config | Vitest projects config | Vitest 3.2 (2025) | Workspace deprecated, same functionality |
| Manual TypeScript project references | Custom export conditions with `customConditions` | Emerging pattern (2024-2025) | Live types without builds |
| npm/yarn workspaces | pnpm workspaces | pnpm maturity (2022+) | Faster, stricter, prevents phantom deps |

**Deprecated/outdated:**
- **Lerna for monorepo management:** Replaced by native pnpm workspaces + Turborepo/Nx for orchestration
- **`@tailwind base/components/utilities` directives:** Replaced by `@import "tailwindcss"` in Tailwind 4.x
- **Convex without schemas for production:** Recommended to add schema after prototype phase for type safety
- **Pod-based Pinecone indexes for new projects:** Serverless is recommended default for auto-scaling

## Open Questions

Things that couldn't be fully resolved:

1. **Specific Embedding Model for 3072 Dimensions**
   - What we know: Phase description specifies 3072 dimensions, which matches OpenAI's text-embedding-3-large
   - What's unclear: Exact embedding model hasn't been decided (could be OpenAI, custom, or other)
   - Recommendation: Document embedding model choice in Phase 2 when implementing scraping pipeline; ensure model outputs 3072-dim vectors

2. **Convex vs Cloudflare Workers Responsibility Split**
   - What we know: Convex for real-time app, Cloudflare for batch data pipeline
   - What's unclear: Exact boundary (e.g., which component triggers scraping jobs, where to store large PDFs)
   - Recommendation: Document in Phase 2; general pattern is Convex stores metadata, Cloudflare R2 stores large files, Workers process batch jobs

3. **React Router vs Single Page App**
   - What we know: Phase specifies "React app scaffolding"
   - What's unclear: Need client-side routing or simple SPA
   - Recommendation: Start with simple SPA (no React Router), add routing in Phase 6 (chat interface) if needed

4. **Monorepo Orchestration Tool Choice**
   - What we know: Need selective CI/CD execution
   - What's unclear: Turborepo vs Nx vs plain pnpm
   - Recommendation: Start with Turborepo for simplicity; lower learning curve, sufficient for build/test caching

## Sources

### Primary (HIGH confidence)
- [pnpm workspaces](https://pnpm.io/workspaces) - Workspace protocol, configuration
- [Convex Schemas](https://docs.convex.dev/database/schemas) - Schema definition patterns
- [Convex TypeScript Best Practices](https://docs.convex.dev/understanding/best-practices/typescript) - Type sharing, generated types
- [Convex React](https://docs.convex.dev/client/react) - Provider setup, hooks
- [Cloudflare Workers TypeScript](https://developers.cloudflare.com/workers/languages/typescript/) - wrangler types, setup
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/) - R2 bindings, configuration
- [Pinecone TypeScript SDK](https://sdk.pinecone.io/typescript/) - createIndex, dimension, metric
- [Pinecone Quickstart](https://docs.pinecone.io/guides/get-started/quickstart) - Index setup patterns
- [Tailwind CSS with React Router](https://tailwindcss.com/docs/installation/framework-guides/react-router) - Vite plugin setup
- [pnpm CI](https://pnpm.io/continuous-integration) - GitHub Actions caching
- [Vitest Workspace](https://vitest.dev/guide/workspace) - Projects configuration

### Secondary (MEDIUM confidence)
- [Live Types in TypeScript Monorepo](https://colinhacks.com/essays/live-types-typescript-monorepo) - Custom export conditions pattern
- [Complete Monorepo Guide 2025](https://jsdev.space/complete-monorepo-guide/) - pnpm workspace best practices verified with official docs
- [Turborepo GitHub Actions](https://turborepo.dev/docs/guides/ci-vendors/github-actions) - CI/CD patterns verified with pnpm CI docs
- [ESLint in Monorepo](https://gregory-gerard.dev/articles/eslint-in-a-monorepo) - Shared config patterns verified with ESLint docs

### Tertiary (LOW confidence)
- [GitHub Actions in 2026 Monorepo Guide](https://dev.to/pockit_tools/github-actions-in-2026-the-complete-guide-to-monorepo-cicd-and-self-hosted-runners-1jop) - Community patterns, not verified with GitHub Actions official docs
- [Monorepo Common Pitfalls](https://graphite.com/guides/monorepo-pitfalls-guide) - Community observations, not verified against official sources
- [Ultimate Guide to Building a Monorepo in 2026](https://medium.com/@sanjaytomar717/the-ultimate-guide-to-building-a-monorepo-in-2025-sharing-code-like-the-pros-ee4d6d56abaa) - Community patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries verified via official documentation and Context7
- Architecture: HIGH - Patterns sourced from official docs (Convex, Cloudflare, pnpm, Pinecone)
- Pitfalls: MEDIUM - Mix of official docs (phantom deps from pnpm) and community experience (tight coupling, bundle size)

**Research date:** 2026-01-31
**Valid until:** 2026-02-28 (30 days for stable infrastructure stack)
