# Testing Patterns

**Analysis Date:** 2026-01-31

## Project Context

This is a monorepo project using pnpm workspaces. Testing strategy varies by workspace type:
- `apps/web` - React components (Vitest + React Testing Library)
- `apps/convex` - Backend functions and actions (Vitest)
- `workers/*` - Cloudflare Workers (Vitest + mocking)
- `packages/*` - Shared utilities (Vitest)

## Test Framework

**Runner:**
- Vitest (primary testing framework)
- Config location: `vitest.config.ts` in each workspace
- Version: ^1.0.0 (or latest stable)

**Assertion Library:**
- Vitest built-in assertions (`expect()`)
- Optional: `@testing-library/jest-dom` for DOM assertions (web app only)

**Run Commands:**

```bash
# Run all tests in current workspace
pnpm test

# Watch mode for development
pnpm test:watch

# Generate coverage report
pnpm test:coverage

# Run single test file
pnpm test src/lib/embeddings.test.ts
```

## Test File Organization

**Location:**
- Co-located with source code in same directory
- Pattern: `[filename].test.ts` for unit tests
- Pattern: `[filename].integration.test.ts` for integration tests

**Example Structure:**
```
apps/web/src/
├── components/
│   ├── ChatInterface.tsx
│   ├── ChatInterface.test.tsx
│   ├── MessageList.tsx
│   └── MessageList.test.tsx
├── hooks/
│   ├── useConversations.ts
│   ├── useConversations.test.ts
│   └── useCompliance.ts
└── lib/
    ├── utils.ts
    └── utils.test.ts
```

**Naming:**
- Test files: `{source-file}.test.ts` or `{source-file}.test.tsx`
- Integration tests: `{source-file}.integration.test.ts`
- Fixtures: `__fixtures__/{name}.json` or `__mocks__/{name}.ts`
- Test suites: Reflect source file structure

## Test Structure

**Suite Organization:**

```typescript
// Example: src/lib/citations.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeCitation, validateCitation } from './citations';

describe('citations', () => {
  describe('normalizeCitation', () => {
    it('should convert citation to standard format', () => {
      const result = normalizeCitation('42 USC § 1234');
      expect(result).toBe('42 U.S.C. 1234');
    });

    it('should handle state statutes', () => {
      const result = normalizeCitation('Tex. Penal Code § 21.02');
      expect(result).toContain('TEX');
    });

    it('should throw on invalid format', () => {
      expect(() => normalizeCitation('invalid')).toThrow('Invalid citation format');
    });
  });

  describe('validateCitation', () => {
    it('should validate federal citations', () => {
      expect(validateCitation('42 USC 1234')).toBe(true);
    });
  });
});
```

**Patterns:**

Setup pattern:
```typescript
describe('VectorService', () => {
  let service: VectorService;
  let mockPinecone: MockedPinecone;

  beforeEach(() => {
    mockPinecone = createMockPinecone();
    service = new VectorService(mockPinecone);
  });

  afterEach(() => {
    mockPinecone.reset();
  });

  // tests
});
```

Teardown pattern:
```typescript
afterEach(() => {
  // Clean up resources
  vi.clearAllMocks();
});

afterAll(() => {
  // Close database connections, etc.
});
```

Assertion pattern:
```typescript
// Prefer descriptive matchers
expect(result).toEqual(expected);
expect(result).toBeDefined();
expect(result).toMatchObject({ id: '123' });
expect(fn).toHaveBeenCalledWith(arg1, arg2);
expect(promise).rejects.toThrow();
```

## Mocking

**Framework:**
- `vitest` built-in mocking (`vi.mock()`)
- Optional: `@vitest/spy` for advanced spying

**Patterns:**

Mock external modules:
```typescript
import { vi } from 'vitest';
import { embedChunks } from './embeddings';

vi.mock('../lib/openai', () => ({
  createEmbedding: vi.fn(async (text) => ({
    vector: new Array(1536).fill(0.1),
    model: 'text-embedding-3-small',
  })),
}));

describe('embedChunks', () => {
  it('should call OpenAI for each chunk', async () => {
    const chunks = [
      { id: '1', text: 'Chunk 1' },
      { id: '2', text: 'Chunk 2' },
    ];

    await embedChunks(chunks);

    expect(vi.mocked(createEmbedding)).toHaveBeenCalledTimes(2);
  });
});
```

Mock Convex functions:
```typescript
// workers/embedding/src/sync.test.ts
import { vi } from 'vitest';

// Mock Convex client
const mockHttpAction = vi.fn(async () => ({
  success: true,
  synced: 100,
}));

vi.mock('convex/server', () => ({
  httpAction: vi.fn(() => mockHttpAction),
}));
```

Mock Pinecone:
```typescript
// Create a mock Pinecone index
const mockIndex = {
  upsert: vi.fn(async () => ({ upsertedCount: 10 })),
  query: vi.fn(async () => ({
    matches: [
      { id: 'chunk-1', score: 0.95, metadata: {} },
    ],
  })),
};

const mockPinecone = {
  Index: vi.fn(() => mockIndex),
};
```

**What to Mock:**
- External API calls (OpenAI, Mapbox, Browserless)
- Database operations (Convex, Pinecone)
- File system operations (if any)
- Date/time (use `vi.useFakeTimers()`)
- Network requests

**What NOT to Mock:**
- Internal utility functions (test them directly)
- Type definitions and interfaces
- Business logic (test real implementations)
- Simple helper functions
- Pure functions without side effects

## Fixtures and Factories

**Test Data:**

```typescript
// __fixtures__/chunks.ts
export const mockChunk = {
  id: 'chunk-001',
  text: 'Section 21.02. Jurisdiction. This code applies to...',
  metadata: {
    jurisdiction_id: 'TX',
    jurisdiction_type: 'state' as const,
    source_type: 'statute' as const,
    citation: 'Tex. Penal Code § 21.02',
    citation_normalized: 'TEX PENAL CODE 21.02',
    section_title: 'Jurisdiction',
    activity_tags: ['criminal', 'jurisdiction'],
    effective_date: '2024-01-01',
    source_url: 'https://example.com/statute',
    last_updated: '2024-01-15',
  },
};

export function createMockChunk(overrides = {}) {
  return {
    ...mockChunk,
    ...overrides,
  };
}
```

Use in tests:
```typescript
import { createMockChunk } from '__fixtures__/chunks';

it('should process chunk metadata', () => {
  const chunk = createMockChunk({
    metadata: { jurisdiction_id: 'CA' },
  });

  const result = enrichMetadata(chunk);
  expect(result.metadata.jurisdiction_id).toBe('CA');
});
```

**Location:**
- `__fixtures__/` directory in same folder as tests
- Or `__mocks__/` for module mocks
- Import as: `import { createMockChunk } from '../__fixtures__/chunks';`

Example structure:
```
apps/convex/src/
├── functions/
│   ├── conversations.ts
│   ├── conversations.test.ts
│   └── __fixtures__/
│       └── conversations.ts
└── actions/
    ├── query.ts
    ├── query.test.ts
    └── __fixtures__/
        └── vectors.ts
```

## Coverage

**Requirements:**
- Minimum target: 70% line coverage
- Focus on critical paths: embeddings, vector search, citation parsing
- Coverage reports: Generate with `pnpm test:coverage`

**View Coverage:**

```bash
# Generate HTML report
pnpm test:coverage

# View in browser (in vitest.config.ts output)
open coverage/index.html
```

**Coverage Configuration** (in `vitest.config.ts`):
```typescript
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/__fixtures__/**',
      ],
    },
  },
});
```

## Test Types

**Unit Tests:**

Scope: Single function or method in isolation

Location: `src/{feature}/{file}.test.ts`

Example:
```typescript
// src/lib/citations.test.ts
describe('normalizeCitation', () => {
  it('should normalize USC citations', () => {
    expect(normalizeCitation('42 USC 1234')).toBe('42 U.S.C. 1234');
  });
});
```

**Integration Tests:**

Scope: Multiple modules working together (e.g., query → embedding → Pinecone)

Location: `src/{feature}/{file}.integration.test.ts`

Example:
```typescript
// src/actions/query.integration.test.ts
describe('RAG Query Integration', () => {
  it('should query vectors and retrieve citations', async () => {
    const query = 'employee classification compliance';

    const result = await queryCompliance(query, 'TX');

    expect(result).toHaveProperty('chunks');
    expect(result.chunks[0]).toHaveProperty('citation');
  });
});
```

**E2E Tests:**

Framework: Not implemented in initial setup

When to add: After MVP launch (higher maintenance cost)

Recommended: Playwright or Cypress for web app

**Worker Tests:**

Test Cloudflare Workers as pure functions:
```typescript
// workers/embedding/src/index.test.ts
import { describe, it, expect } from 'vitest';
import { embedChunk } from './index';

describe('Embedding Worker', () => {
  it('should handle batch embed requests', async () => {
    const env = {
      OPENAI_API_KEY: 'sk-test',
      PINECONE_API_KEY: 'test-key',
    };

    const result = await embedChunk({ chunks: [...] }, env);
    expect(result.success).toBe(true);
  });
});
```

## Common Patterns

**Async Testing:**

```typescript
// Using async/await
it('should fetch compliance data', async () => {
  const result = await fetchCompliance('TX', 'employment');
  expect(result).toHaveLength(5);
});

// Using Promises
it('should reject on invalid jurisdiction', () => {
  return expect(fetchCompliance('INVALID', 'test')).rejects.toThrow();
});
```

**Error Testing:**

```typescript
describe('embedVectors', () => {
  it('should throw on API failure', async () => {
    const mockApi = vi.fn().mockRejectedValue(new Error('API Error'));

    await expect(embedVectors(texts, mockApi))
      .rejects
      .toThrow('API Error');
  });

  it('should handle partial failures', async () => {
    const mockApi = vi.fn()
      .mockResolvedValueOnce({ vector: [...] })
      .mockRejectedValueOnce(new Error('Rate limited'));

    // test handling
  });
});
```

**Hook Testing** (React):

```typescript
import { renderHook, act } from '@testing-library/react';
import { useConversations } from './useConversations';

it('should fetch conversations on mount', async () => {
  const { result } = renderHook(() => useConversations('user-1'));

  await act(async () => {
    // wait for async operations
  });

  expect(result.current.conversations).toHaveLength(3);
});
```

**Component Testing** (React):

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInterface } from './ChatInterface';

it('should submit message on button click', async () => {
  render(<ChatInterface />);

  const input = screen.getByPlaceholderText('Ask about compliance...');
  await userEvent.type(input, 'Employee classification');

  const button = screen.getByRole('button', { name: /send/i });
  await userEvent.click(button);

  expect(screen.getByText(/searching/i)).toBeInTheDocument();
});
```

## Vitest Configuration Example

**File:** `vitest.config.ts` (root or per-workspace)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom', // for React components
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/__fixtures__/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@compliance-iq/types': '../../../packages/types/src',
    },
  },
});
```

**Setup File:** `vitest.setup.ts`

```typescript
import { expect, afterEach, vi } from 'vitest';

// Global test cleanup
afterEach(() => {
  vi.clearAllMocks();
});

// Optional: Configure test utilities
if (typeof window !== 'undefined') {
  // Browser environment setup
}
```

---

*Testing analysis: 2026-01-31*
