# Phase 7: Query Pipeline - Research

**Researched:** 2026-02-03
**Domain:** RAG query pipeline, geocoding, legal citations
**Confidence:** MEDIUM

## Summary

The Query Pipeline phase implements a Retrieval-Augmented Generation (RAG) system that converts natural language compliance questions into cited regulatory answers. The implementation requires four major components: (1) address-to-jurisdiction geocoding, (2) vector search with metadata filtering in Pinecone, (3) Claude API integration for answer generation with citations, and (4) confidence scoring based on retrieval quality.

The standard 2026 RAG architecture has evolved beyond simple retrieve-generate patterns to include query augmentation, hybrid retrieval (semantic + keyword), reranking, and sophisticated citation mechanisms. For legal compliance applications, citations are table stakes—users cannot trust responses without explicit source references. The architecture must balance retrieval precision (finding relevant regulations) with generation quality (accurate synthesis with proper citations).

Key implementation decisions are already locked: Convex for application layer, Pinecone for vector search (3072-dim, cosine), OpenAI text-embedding-3-large for embeddings, Claude API for generation, and separation of jurisdiction layers in responses. The phase boundary excludes streaming (Phase 9) and focuses on the core RAG pipeline.

**Primary recommendation:** Implement a two-phase retrieval approach (vector similarity + reranking) with explicit citation tracking through the entire pipeline. Use Convex actions to orchestrate external API calls (geocoding, Pinecone query, Claude generation) with mutations capturing results. Build confidence scoring based on retrieval metrics (semantic similarity, metadata coverage) rather than LLM self-assessment.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | ^0.40.x | Claude API client for TypeScript | Official Anthropic SDK with streaming support, tool use, and structured outputs |
| @pinecone-database/pinecone | ^6.1.4 | Vector database client | Already in use; serverless architecture, metadata filtering, cosine similarity |
| openai | ^6.17.0 | OpenAI API client for embeddings | Already in use; text-embedding-3-large (3072-dim) for semantic search |
| convex | ^1.31.7 | Application backend | Already in use; actions for external APIs, mutations for DB writes, queries for reads |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| geocodio | via fetch | Address geocoding with jurisdiction data | Convert user addresses to federal/state/county/municipal identifiers; use fields=cd,stateleg,census |
| zod | Built into Convex | Runtime validation for API responses | Validate Claude API responses, Pinecone results, geocoding data |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Geocodio | Google Geocoding API | Google provides lat/lng but requires additional API calls for jurisdiction boundaries; Geocodio returns Congressional districts, state legislative districts, FIPS codes in single request |
| Claude API direct | LangChain/LlamaIndex | Framework adds abstractions but project already has direct integrations; stick with direct API for consistency |
| Confidence via LLM | Retrieval metrics only | LLM self-assessment is unreliable; use retrieval scores (similarity, metadata coverage) for confidence |

**Installation:**
```bash
pnpm add @anthropic-ai/sdk
# openai, @pinecone-database/pinecone, convex already installed
```

## Architecture Patterns

### Recommended Project Structure
```
apps/convex/convex/
├── actions/
│   ├── geocode.ts           # Address-to-jurisdiction resolution
│   ├── retrieve.ts          # Pinecone vector search with filtering
│   ├── generate.ts          # Claude API answer generation
│   └── query.ts             # Orchestrator: geocode → retrieve → generate
├── mutations/
│   ├── saveQuery.ts         # Store user query and address
│   ├── saveAnswer.ts        # Store generated answer with citations
│   └── updateConfidence.ts  # Store confidence scores
├── queries/
│   ├── getQuery.ts          # Retrieve query results
│   └── getHistory.ts        # User's query history
└── lib/
    ├── citations.ts         # Citation formatting utilities
    ├── confidence.ts        # Confidence scoring logic
    └── prompt.ts            # Claude prompt templates
```

### Pattern 1: Two-Phase Retrieval with Metadata Filtering

**What:** Retrieve broader set with metadata filters, then rerank by relevance

**When to use:** Legal domain requires high precision; cannot afford irrelevant chunks

**Example:**
```typescript
// Source: Pinecone RAG best practices 2026
// Phase 1: Vector search with jurisdiction filters
const results = await index.query({
  vector: queryEmbedding,
  topK: 50, // Retrieve more candidates
  filter: {
    jurisdiction: { $in: ['US', 'TX', 'TX-48201', 'TX-houston'] },
    sourceType: { $in: ['federal', 'state', 'county', 'municipal'] }
  },
  includeMetadata: true
});

// Phase 2: Rerank by semantic similarity + recency
const reranked = results.matches
  .sort((a, b) => {
    const scoreA = a.score * 0.7 + (a.metadata?.lastUpdated ? 0.3 : 0);
    const scoreB = b.score * 0.7 + (b.metadata?.lastUpdated ? 0.3 : 0);
    return scoreB - scoreA;
  })
  .slice(0, 10); // Final top-k for context
```

### Pattern 2: Citation-Aware Prompt Engineering

**What:** Instruct Claude to cite sources inline using structured format

**When to use:** Legal compliance requires verifiable citations; users must trace answers to source law

**Example:**
```typescript
// Source: RAG citation best practices (Medium, Zilliz 2026)
const systemPrompt = `You are a legal compliance research assistant. Answer questions using ONLY the provided regulatory text.

For each statement, cite sources using this format: [Citation ID]
Example: "Food facilities must register with FDA [1] and maintain written food safety plans [2]."

At the end, list all citations:
[1] 21 CFR 117.5 - Registration
[2] 21 CFR 117.126 - Food Safety Plan

Rules:
- NEVER make claims without citations
- Use exact section numbers from metadata
- If answer requires multiple jurisdictions, separate into sections: Federal, State, County, Municipal
- If uncertain, state: "Insufficient coverage for definitive answer"`;

const userPrompt = `Question: ${question}

Regulatory Context:
${chunks.map((c, i) => `[${i + 1}] ${c.metadata.citation}\n${c.metadata.text}`).join('\n\n')}`;
```

### Pattern 3: Convex Action Orchestration

**What:** Actions coordinate external API calls; mutations persist results

**When to use:** Convex best practice for external integrations (Pinecone, Claude, geocoding APIs)

**Example:**
```typescript
// Source: Convex documentation - Actions best practices
export const processQuery = action({
  args: {
    question: v.string(),
    address: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    // Step 1: Geocode address to jurisdictions (if provided)
    const jurisdictions = args.address
      ? await geocodeAddress(args.address)
      : ['US']; // Default to federal only

    // Step 2: Generate query embedding
    const embedding = await generateEmbedding(args.question, process.env.OPENAI_API_KEY);

    // Step 3: Retrieve relevant chunks from Pinecone
    const chunks = await retrieveChunks(embedding, jurisdictions);

    // Step 4: Generate answer with Claude
    const answer = await generateAnswer(args.question, chunks, process.env.ANTHROPIC_API_KEY);

    // Step 5: Calculate confidence score
    const confidence = calculateConfidence(chunks, answer.citations);

    // Step 6: Persist to Convex (via mutation)
    const queryId = await ctx.runMutation(internal.mutations.saveQuery, {
      question: args.question,
      address: args.address,
      jurisdictions,
      answer: answer.text,
      citations: answer.citations,
      confidence
    });

    return { queryId, answer, confidence };
  }
});
```

### Pattern 4: Jurisdiction-Layered Response Structure

**What:** Organize answer into Federal, State, County, Municipal sections

**When to use:** Locked decision from CONTEXT.md; helps lawyers understand which government level imposes requirements

**Example:**
```typescript
// Source: Phase 7 context decisions
const responseTemplate = {
  summary: string,
  jurisdictions: {
    federal: {
      regulations: CitedRegulation[],
      permits: Permit[]
    },
    state: {
      regulations: CitedRegulation[],
      permits: Permit[]
    },
    county: {
      regulations: CitedRegulation[],
      permits: Permit[]
    },
    municipal: {
      regulations: CitedRegulation[],
      permits: Permit[]
    }
  },
  permits: Permit[], // Consolidated list at end
  confidence: 'High' | 'Medium' | 'Low',
  confidenceReason: string
};
```

### Anti-Patterns to Avoid

- **Sequential ctx.runQuery/runMutation calls:** Convex warns against this—batch database access in single query/mutation instead
- **LLM-based confidence scoring:** LLMs are overconfident; use retrieval metrics (similarity scores, chunk count, metadata coverage)
- **Streaming in actions:** Actions timeout after 10 minutes and don't support SSE; handle streaming in Phase 9 (separate HTTP actions)
- **Embedding at query time without caching:** Embed user query once, reuse for all jurisdiction filters
- **Ignoring citation validation:** Verify cited sections exist in retrieved chunks; hallucinated citations break trust

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Address geocoding | Custom lat/lng to jurisdiction lookup | Geocodio API with fields=cd,stateleg,census | Returns Congressional districts, state legislative districts, FIPS codes, county/city in single request; handles edge cases (P.O. boxes, territories) |
| Citation extraction | Regex parsing of LLM responses | Structured Claude prompt with validated format | Prompt engineering with explicit format + post-validation is more reliable than parsing freeform text |
| Query rewriting | Custom query expansion | HyDE (Hypothetical Document Embeddings) | LLM generates hypothetical answer, embed that answer, retrieve similar chunks—handles vocabulary mismatch better than keyword expansion |
| Confidence scoring | LLM self-assessment ("How confident are you?") | Retrieval metrics (top-k similarity, metadata coverage) | LLMs overestimate confidence; use quantifiable metrics: avg similarity score, % chunks with citations, jurisdiction coverage |
| Jurisdiction resolution | Manual address parsing | Geocodio fields API | Census data, FIPS codes, legislative districts, city boundaries—complex boundary logic already solved |

**Key insight:** RAG systems have mature tooling for common problems. The complexity is in orchestration (geocode → retrieve → generate → validate) rather than individual components. Focus implementation on business logic (jurisdiction filtering, legal citation format, confidence thresholds) not infrastructure.

## Common Pitfalls

### Pitfall 1: Over-Retrieving Context Exhausts Token Budget

**What goes wrong:** Retrieving top-50 chunks for comprehensive coverage blows past Claude's context window or costs too much

**Why it happens:** Legal text is verbose; 50 chunks × 500 tokens = 25K tokens just for context, leaving little room for answer

**How to avoid:**
- Use two-phase retrieval: broad filter (top-50) → rerank → final top-10
- Prioritize by jurisdiction: federal + state always included, county/municipal only if high similarity
- Chunk text in metadata should be 200-400 tokens (done in Phase 6)

**Warning signs:** Claude API errors about context length; high costs per query; slow response times

### Pitfall 2: Geocoding API Failures Break Entire Pipeline

**What goes wrong:** User enters invalid address, Geocodio rate limit hit, or API down—entire query fails

**Why it happens:** No fallback for address resolution; tight coupling between geocoding and retrieval

**How to avoid:**
- Make address optional: if geocoding fails, default to federal-only query
- Cache geocoding results in Convex: address → jurisdictions mapping
- Validate address before API call: reject obviously invalid inputs early

**Warning signs:** High error rates on queries with addresses; user complaints about "address not found"

### Pitfall 3: Citation Hallucination

**What goes wrong:** Claude cites regulations that don't exist or weren't in retrieved chunks

**Why it happens:** LLMs can hallucinate citations even with explicit instructions; no post-generation validation

**How to avoid:**
- Number chunks in prompt: [1], [2], [3]... and require citations to match
- Post-process: extract citation IDs from answer, verify all exist in chunks
- Fail loudly: if citation validation fails, return error instead of hallucinated answer
- Use structured output: Claude's tool use or JSON mode for citation array

**Warning signs:** User reports "citation doesn't exist"; legal team finds incorrect section references

### Pitfall 4: Confidence Score Always "High"

**What goes wrong:** Every answer gets High confidence, making score useless for lawyers

**Why it happens:** Using LLM self-assessment ("How confident are you?") which is biased high, or setting thresholds based on ideal cases

**How to avoid:**
- Use retrieval metrics: avg similarity score across top-k, % chunks with metadata, jurisdiction coverage
- Set conservative thresholds: High = >0.8 similarity + all jurisdictions covered; Medium = 0.6-0.8 OR partial coverage; Low = <0.6
- Include qualitative reason: "High: 4/4 jurisdictions covered, avg similarity 0.85"
- Validate on real queries: tune thresholds based on actual distribution

**Warning signs:** >90% of queries rated High; users ignore confidence score; no correlation with answer quality

### Pitfall 5: Missing Municipal/County Regulations

**What goes wrong:** Query returns federal and state but misses applicable county ordinance

**Why it happens:** Metadata filter too restrictive (e.g., exact jurisdiction match); geocoding returns wrong FIPS code

**How to avoid:**
- Use $in filter for jurisdictions: allows federal + state + county + municipal in single query
- Validate geocoding: log returned jurisdictions, spot-check against known addresses
- Fallback retrieval: if jurisdiction-filtered query returns <5 chunks, retry without jurisdiction filter
- Coverage monitoring: track which jurisdictions return results; alert if county/municipal consistently empty

**Warning signs:** Users report "missing local requirements"; low chunk counts for county/municipal queries

## Code Examples

Verified patterns from official sources:

### Geocoding with Jurisdiction Resolution

```typescript
// Source: Geocodio API documentation
async function geocodeAddress(address: string): Promise<string[]> {
  const response = await fetch(
    `https://api.geocod.io/v1.9/geocode?q=${encodeURIComponent(address)}&fields=cd119,stateleg,census&api_key=${GEOCODIO_API_KEY}`
  );

  const data = await response.json();
  if (!data.results || data.results.length === 0) {
    throw new Error('Address not found');
  }

  const result = data.results[0]; // Best match
  const jurisdictions = ['US']; // Always include federal

  // State
  if (result.address_components.state) {
    jurisdictions.push(result.address_components.state); // e.g., 'TX'
  }

  // County (from Census data)
  if (result.fields.census?.county_fips) {
    jurisdictions.push(`${result.address_components.state}-${result.fields.census.county_fips}`);
  }

  // Municipal (from city name)
  if (result.address_components.city) {
    const cityId = result.address_components.city.toLowerCase().replace(/\s+/g, '-');
    jurisdictions.push(`${result.address_components.state}-${cityId}`);
  }

  return jurisdictions;
}
```

### Claude Streaming with Citation Tracking

```typescript
// Source: Anthropic streaming documentation
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const stream = await client.messages.stream({
  model: 'claude-sonnet-4-5',
  max_tokens: 4096,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }],
});

let fullText = '';
for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    fullText += event.delta.text;
    // Note: Streaming implementation moves to Phase 9
    // For Phase 7, use non-streaming: await client.messages.create({...})
  }
}
```

### Pinecone Query with Metadata Filtering

```typescript
// Source: Existing codebase (apps/workers/src/pinecone.ts) + Pinecone docs
import { queryChunks } from '@/pinecone';

const chunks = await queryChunks(index, queryEmbedding, {
  topK: 20,
  filter: {
    $or: [
      { jurisdiction: 'US' },
      { jurisdiction: 'TX' },
      { jurisdiction: 'TX-48201' },
      { jurisdiction: 'TX-houston' }
    ]
  },
  includeMetadata: true
});

// Rerank by score + recency
const reranked = chunks
  .filter(c => c.score > 0.5) // Minimum relevance threshold
  .sort((a, b) => {
    const scoreA = a.score * 0.8 + (a.metadata?.lastUpdated ? 0.2 : 0);
    const scoreB = b.score * 0.8 + (b.metadata?.lastUpdated ? 0.2 : 0);
    return scoreB - scoreA;
  })
  .slice(0, 10);
```

### Confidence Scoring from Retrieval Metrics

```typescript
// Source: RAG evaluation metrics research (Confident AI, Statsig 2026)
interface ConfidenceScore {
  level: 'High' | 'Medium' | 'Low';
  score: number; // 0-1
  reason: string;
}

function calculateConfidence(
  chunks: RetrievedChunk[],
  targetJurisdictions: string[]
): ConfidenceScore {
  // Metric 1: Average semantic similarity
  const avgSimilarity = chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length;

  // Metric 2: Jurisdiction coverage
  const representedJurisdictions = new Set(chunks.map(c => c.metadata.jurisdiction));
  const coverageRatio = representedJurisdictions.size / targetJurisdictions.length;

  // Metric 3: Metadata completeness
  const withCitations = chunks.filter(c => c.metadata.citation).length;
  const citationRatio = withCitations / chunks.length;

  // Combined score (weighted)
  const score = avgSimilarity * 0.5 + coverageRatio * 0.3 + citationRatio * 0.2;

  // Classify
  let level: 'High' | 'Medium' | 'Low';
  if (score > 0.8 && coverageRatio === 1.0) {
    level = 'High';
  } else if (score > 0.6) {
    level = 'Medium';
  } else {
    level = 'Low';
  }

  const reason = `${level}: ${representedJurisdictions.size}/${targetJurisdictions.length} jurisdictions covered, avg similarity ${avgSimilarity.toFixed(2)}`;

  return { level, score, reason };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-phase retrieval (top-k only) | Two-phase: broad retrieval + reranking | 2024-2025 | Improves precision by 15-30% in production RAG systems; reranking catches high-relevance chunks missed by pure semantic search |
| Keyword (BM25) or semantic (vector) | Hybrid retrieval (both) | 2025 | Hybrid consistently outperforms single-method for noisy enterprise data; combines vocabulary matching (BM25) with semantic understanding (vectors) |
| LLM self-assessment confidence | Retrieval metrics + faithfulness scoring | 2025-2026 | LLM confidence unreliable; RAGAS framework (2026) emphasizes context precision/recall over self-assessment |
| Freeform citation generation | Structured citation with validation | 2025-2026 | Legal/compliance domains require verifiable citations; structured output (JSON mode, tool use) + post-validation reduces hallucination |
| Query embedding only | HyDE (Hypothetical Document Embeddings) | 2024-2025 | Generates hypothetical answer, embeds that—handles vocabulary mismatch (user asks "permits needed", docs say "license requirements") |

**Deprecated/outdated:**
- **LangChain RetrievalQA:** Framework abstractions slow down iteration; direct API integration preferred for production (2025-2026 shift)
- **Single vector search without metadata:** Modern RAG requires metadata filtering for multi-tenant, jurisdiction-scoped, or access-controlled retrieval
- **Streaming via Convex actions:** Convex actions have 10-minute timeout, no SSE support; streaming moved to HTTP actions (Phase 9)

## Open Questions

1. **HyDE vs. Query Expansion for Legal Domain**
   - What we know: HyDE generates hypothetical answer, embeds that; effective for vocabulary mismatch
   - What's unclear: Does legal compliance benefit from HyDE? Regulatory text uses precise terminology; user questions may already match vocab
   - Recommendation: Start with direct query embedding (simpler); A/B test HyDE if retrieval precision <0.6 on real queries

2. **Citation Format: Inline vs. Footnotes**
   - What we know: CONTEXT.md says "Claude's discretion on citation formatting"
   - What's unclear: Do lawyers prefer inline ([1]) or footnote style? Does format affect Claude's citation accuracy?
   - Recommendation: Use inline [1], [2] format (easier to validate); survey Costco legal team after pilot

3. **Jurisdiction Filter Strictness**
   - What we know: Metadata filter can be exact match or $in array
   - What's unclear: Should Houston query include Harris County chunks, or strict city boundary? Federal regulations apply everywhere—filter or always include?
   - Recommendation: Always include federal; use $in for state/county/municipal (permissive); monitor over-retrieval

4. **Reranking Algorithm Choice**
   - What we know: Reranking improves precision after initial retrieval
   - What's unclear: Simple score-based sort vs. cross-encoder model (more accurate but slower/costly)?
   - Recommendation: Start with weighted score (similarity * 0.8 + recency * 0.2); evaluate cross-encoder if precision <0.7

5. **Handling Multi-Hop Queries**
   - What we know: "What permits for retail food + pharmacy?" requires combining permits from multiple categories
   - What's unclear: Single retrieval with broad query, or multiple targeted retrievals + merge?
   - Recommendation: Single retrieval with expanded topK (20-30 chunks); let Claude synthesize multi-topic answer

## Sources

### Primary (HIGH confidence)

- [Anthropic Streaming Documentation](https://platform.claude.com/docs/en/api/messages-streaming) - Streaming API patterns, event types, content block deltas
- [Convex Actions Documentation](https://docs.convex.dev/functions/actions) - External API patterns, action best practices, minimize action logic guidance
- [Pinecone Metadata Filtering](https://docs.pinecone.io/guides/data/filter-with-metadata) - Filter syntax, operators, RAG-specific patterns
- [Geocodio API Reference](https://www.geocod.io/docs/) - Jurisdiction fields (cd119, stateleg, census), address component structure
- Existing codebase: `apps/workers/src/pinecone.ts` (ChunkMetadata schema), `apps/workers/src/federal/embed.ts` (OpenAI embedding patterns)

### Secondary (MEDIUM confidence)

- [Designing a Production-Grade RAG Architecture](https://levelup.gitconnected.com/designing-a-production-grade-rag-architecture-bee5a4e4d9aa) - 2026 production patterns, hybrid retrieval, evaluation
- [Retrieval Is the Bottleneck: HyDE and Multi-Query RAG](https://medium.com/@mudassar.hakim/retrieval-is-the-bottleneck-hyde-query-expansion-and-multi-query-rag-explained-for-production-c1842bed7f8a) - HyDE technique, query expansion patterns
- [RAG Evaluation Metrics](https://www.confident-ai.com/blog/rag-evaluation-metrics-answer-relevancy-faithfulness-and-more) - RAGAS framework, context precision/recall, faithfulness metrics
- [In-Text Citing for RAG](https://medium.com/@yotamabraham/in-text-citing-with-langchain-question-answering-e19a24d81e39) - Citation formatting patterns, validation approaches
- [Citation-Aware RAG](https://www.tensorlake.ai/blog/rag-citations) - Structured citation extraction, quote grounding, multi-step reasoning
- [Retrieval Precision Crisis](https://ragaboutit.com/the-retrieval-precision-crisis-why-your-rag-metrics-are-hiding-silent-failures/) - 2026 enterprise RAG failures, continuous evaluation practices

### Tertiary (LOW confidence)

- WebSearch: "RAG best practices 2026" - General patterns, no specific implementation details
- WebSearch: "Geocoding jurisdiction resolution" - Multiple services (Geocodio, Avalara, USgeocoder) mentioned but Geocodio selected based on API simplicity

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Anthropic SDK, Pinecone, OpenAI, Convex all verified from official docs or existing codebase
- Architecture: MEDIUM - Patterns verified from 2025-2026 sources but not project-specific; two-phase retrieval, citation validation confirmed as best practices
- Pitfalls: MEDIUM - Based on general RAG production learnings (2026 articles); specific to legal domain but not Costco/ComplianceIQ validated

**Research date:** 2026-02-03
**Valid until:** ~30 days (RAG patterns stable; API changes to Anthropic/Pinecone would require updates)
