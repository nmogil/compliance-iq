# Coding Conventions

**Analysis Date:** 2026-01-31

## Project Context

This is a monorepo project using pnpm workspaces with the following structure:
- `apps/web` - React frontend
- `apps/convex` - Convex backend
- `workers/*` - Cloudflare Workers (data pipeline)
- `packages/*` - Shared utilities and types

## Naming Patterns

**Files:**
- TypeScript source files: lowercase with hyphens for multi-word names (e.g., `message-handler.ts`)
- Components: PascalCase for React components (e.g., `ChatInterface.tsx`)
- Utilities: camelCase for function/utility files (e.g., `embeddings.ts`)
- Configuration files: lowercase with dots (e.g., `convex.json`, `wrangler.toml`)

**Functions:**
- Exported functions: camelCase (e.g., `fetchUserConversations()`, `normalizeJurisdiction()`)
- React hooks: camelCase with `use` prefix (e.g., `useConversations()`, `useCompliance()`)
- Handler functions: camelCase with descriptive verbs (e.g., `handleMessageSubmit()`, `processChunk()`)

**Variables:**
- Local variables: camelCase (e.g., `jurisdictionId`, `messageContent`)
- Constants: UPPER_SNAKE_CASE (e.g., `MAX_CHUNK_SIZE`, `API_TIMEOUT_MS`)
- React props: camelCase (e.g., `onMessageSubmit`, `isLoading`)

**Types:**
- Interface names: PascalCase with prefix if domain-specific (e.g., `ChunkMetadata`, `JurisdictionConfig`)
- Type aliases: PascalCase (e.g., `ActivityTags`, `CitationType`)
- Enum names: PascalCase (e.g., `JurisdictionType`, `SourceType`)
- Enum values: UPPER_SNAKE_CASE (e.g., `FEDERAL`, `STATE`, `MUNICIPAL`)

## Code Style

**Formatting:**
- Language: TypeScript 5.0+
- Line length: 100 characters (configurable per workspace)
- Indentation: 2 spaces (standard for Node.js/web projects)
- Use semicolons for statement termination
- Trailing commas in multi-line objects/arrays

**Linting:**
- Tool: ESLint (to be configured per workspace)
- TypeScript strict mode: Enabled (`"strict": true` in tsconfig.json)

**Import Organization:**
Order imports as follows:
1. External packages (node modules, npm dependencies)
2. Workspace packages (`@compliance-iq/*`)
3. Absolute imports from project (if configured)
4. Relative imports (from same package)

Example:
```typescript
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import type { ChunkMetadata } from '@compliance-iq/types';
import { normalizeJurisdiction } from '@compliance-iq/shared';
import { logger } from '../lib/logger';
import { validateCitation } from './citation';
```

**Path Aliases:**
- `@compliance-iq/types` → `packages/types/src`
- `@compliance-iq/shared` → `packages/shared/src`
- `@compliance-iq/config` → `packages/config/src`

Configure in each workspace's `tsconfig.json`:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@compliance-iq/*": ["../../packages/*/src"]
    }
  }
}
```

## Error Handling

**Patterns:**
- Use typed errors with custom error classes for domain-specific failures
- Throw errors with descriptive messages including context
- Return `Result<T, E>` types or similar for recoverable errors in async operations
- Use try-catch only for truly exceptional cases (not control flow)

Example:
```typescript
class PineconeError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'PineconeError';
  }
}

async function queryVectors(query: string): Promise<SearchResult[]> {
  try {
    const embedding = await getEmbedding(query);
    return await pinecone.query(embedding);
  } catch (error) {
    if (error instanceof PineconeError) {
      logger.error('Vector search failed', { code: error.code, query });
      throw new Error(`Search failed: ${error.message}`);
    }
    throw error;
  }
}
```

## Logging

**Framework:** console (to be wrapped with structured logging)

**Patterns:**
- Use `console.log()` for info-level logs
- Use `console.error()` for error logs with stack traces
- Include structured context with every log: `{ key: value }`
- Log at boundaries: API calls, database operations, errors

Example:
```typescript
logger.info('Processing chunk', {
  chunkId: chunk.id,
  jurisdiction: chunk.metadata.jurisdiction_id,
  size: chunk.text.length,
});

logger.error('Failed to upsert to Pinecone', {
  error: err.message,
  vectors: vectorIds,
  retryAttempt: attempt,
});
```

## Comments

**When to Comment:**
- Complex algorithms: explain the approach, not the code
- Non-obvious business logic: explain why, not what
- Workarounds: explain the constraint and why the workaround exists
- Do NOT comment obvious code (e.g., `// increment counter` for `i++`)

**JSDoc/TSDoc:**
- Export functions should have JSDoc comments
- Document parameters with `@param`, return values with `@returns`
- Document thrown errors with `@throws`
- Mark internal/private functions with `@internal`

Example:
```typescript
/**
 * Fetch and process compliance data for a jurisdiction.
 *
 * @param jurisdiction - The jurisdiction identifier (e.g., 'TX', 'US')
 * @param activityCode - Business activity code for filtering
 * @returns Promise resolving to compliance chunks with metadata
 * @throws {JurisdictionError} If jurisdiction not found
 * @throws {PineconeError} If vector search fails
 *
 * @internal Use through ConvexDB queries, not directly
 */
export async function fetchCompliance(
  jurisdiction: string,
  activityCode: string
): Promise<Chunk[]> {
  // implementation
}
```

## Function Design

**Size:**
- Target: 20-30 lines per function
- Maximum: 50 lines before refactoring
- Extract long conditional blocks to named functions

**Parameters:**
- Prefer 3 or fewer parameters
- Use object parameters for 4+ arguments: `function process({ chunkId, jurisdiction, metadata })`
- Use defaults for optional parameters
- Document parameter types with TypeScript, not JSDoc (unless complex)

**Return Values:**
- Be explicit about return type (always annotate in functions)
- Return early to reduce nesting
- Async functions always return Promise (even if void)

Example:
```typescript
async function enrichMetadata(
  chunk: RawChunk,
  options: EnrichOptions = {}
): Promise<ChunkWithMetadata> {
  if (!chunk.text) {
    throw new Error('Chunk text is required');
  }

  const normalized = normalizeJurisdiction(chunk.jurisdiction);
  if (!normalized) {
    throw new Error(`Unknown jurisdiction: ${chunk.jurisdiction}`);
  }

  return {
    ...chunk,
    metadata: {
      ...chunk.metadata,
      jurisdiction_normalized: normalized,
      processed_at: new Date().toISOString(),
    },
  };
}
```

## Module Design

**Exports:**
- One primary export per file (use default export for main class/function)
- Named exports for utilities and types
- Re-export related types at module boundaries

Example (`lib/embeddings.ts`):
```typescript
export interface EmbeddingResult {
  vector: number[];
  model: string;
}

export class EmbeddingService {
  async embed(text: string): Promise<EmbeddingResult> {
    // implementation
  }
}

export default EmbeddingService;
```

**Barrel Files:**
- Use `index.ts` for re-exporting public API from directories
- Example: `src/lib/index.ts` re-exports all utilities

```typescript
// packages/types/src/index.ts
export type { ChunkMetadata, ChunkVector } from './chunk';
export type { Jurisdiction, JurisdictionConfig } from './jurisdiction';
export type { Citation, CitationNormalized } from './citation';
```

## Database & State

**Convex Schema:**
- Define tables in `convex/schema.ts`
- Use descriptive field names (snake_case for database fields)
- Index frequently queried fields
- Document schema with comments

**Mutation Patterns:**
- File: `convex/functions/{domain}.ts` (e.g., `conversations.ts`, `messages.ts`)
- Export both queries and mutations from same file
- Validate inputs with runtime schema validation (e.g., Zod, Convex validators)

Example (`convex/functions/conversations.ts`):
```typescript
import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

export const listConversations = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query('conversations')
      .filter(q => q.eq(q.field('userId'), userId))
      .collect();
  },
});

export const createConversation = mutation({
  args: { userId: v.string(), title: v.string() },
  handler: async (ctx, { userId, title }) => {
    return await ctx.db.insert('conversations', { userId, title });
  },
});
```

## Async/Await

**Pattern:**
- Prefer async/await over `.then()` chains
- Use `try-catch` for error handling in async functions
- Avoid `Promise.all()` without error handling for independent operations

Example:
```typescript
// Good
async function processChunks(chunks: Chunk[]): Promise<void> {
  for (const chunk of chunks) {
    try {
      await processChunk(chunk);
    } catch (error) {
      logger.error('Failed to process chunk', { chunkId: chunk.id, error });
    }
  }
}

// Also good for independent operations
const [embeddings, jurisdictions] = await Promise.all([
  getEmbeddings(texts),
  getJurisdictions(),
]);
```

---

*Convention analysis: 2026-01-31*
