# Technical Architecture: Convex + Cloudflare Hybrid

## Overview

This document details the technical implementation for the regulatory compliance system, using a **hybrid architecture**:

- **Convex** — Application layer: real-time chat, conversations, auth, query orchestration, LLM calls
- **Cloudflare** — Data pipeline: scraping, ingestion, document storage, embedding, external REST API
- **Pinecone** — Vector database: regulatory text embeddings with metadata-filtered search

The React frontend connects directly to Convex (no proxy). External consumers (Costco internal tools, future API customers) hit a Cloudflare Workers REST API.

---

## Architecture Principles

1. **Convex-Direct**: React frontend connects to Convex SDK directly — no proxy, no middleware
2. **Real-Time Native**: Reactive subscriptions for chat, streaming, and live status updates
3. **Type-Safe End-to-End**: Convex schema defines the API contract — frontend gets auto-complete
4. **Pipeline Separation**: Batch data work (scraping, embedding) runs on Cloudflare, decoupled from the application
5. **External API as P2**: REST API for third-party consumers built later on Cloudflare Workers

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
│                                                                              │
│    ┌──────────────────────┐         ┌──────────────────────┐                │
│    │  React App           │         │  External Consumers   │                │
│    │  (Chat UI +          │         │  (Costco tools,       │                │
│    │   Dashboard)         │         │   future API users)   │                │
│    └──────────┬───────────┘         └──────────┬───────────┘                │
│               │                                │                             │
│               │  useQuery()                    │  REST / HTTP                │
│               │  useMutation()                 │                             │
│               │  useAction()                   │                             │
└───────────────┼────────────────────────────────┼─────────────────────────────┘
                │                                │
                ▼                                ▼
┌───────────────────────────────┐   ┌──────────────────────────────────────────┐
│                               │   │                                          │
│          CONVEX               │   │        CLOUDFLARE WORKERS                │
│     (Application Layer)       │   │        (External REST API)               │
│                               │   │                                          │
│  ┌─────────────────────────┐  │   │   api.complianceiq.dev                  │
│  │       QUERIES           │  │   │                                          │
│  │                         │  │   │   POST /v1/query                        │
│  │  conversations.list     │  │   │   POST /v1/query/stream                 │
│  │  messages.byConversation│  │   │   GET  /v1/jurisdictions                │
│  │  jurisdictions.list     │  │   │   POST /v1/address/resolve              │
│  │  jurisdictions.get      │  │   │   GET  /v1/activities                   │
│  │  sources.freshness      │  │   │   GET  /v1/sources/:id                  │
│  │  activities.list        │  │   │   GET  /v1/health                       │
│  └─────────────────────────┘  │   │                                          │
│                               │   │   Auth: API key (header)                │
│  ┌─────────────────────────┐  │   │   Rate Limit: Cloudflare built-in      │
│  │      MUTATIONS          │  │   │                                          │
│  │                         │  │   │   Implementation:                        │
│  │  conversations.create   │  │   │   → Calls Convex HTTP Actions           │
│  │  conversations.archive  │  │   │   → Thin proxy, no duplicated logic     │
│  │  messages.send          │  │   │                                          │
│  │  messages.updateStatus  │  │   └──────────────────────────────────────────┘
│  │  feedback.submit        │  │
│  └─────────────────────────┘  │
│                               │
│  ┌─────────────────────────┐  │
│  │       ACTIONS           │  │
│  │  (Server-side, async)   │  │
│  │                         │  │
│  │  query.execute:         │  │
│  │   1. Geocode (Mapbox)   │  │
│  │   2. Search (Pinecone)  │  │──────────► PINECONE
│  │   3. Rerank results     │  │
│  │   4. Call Claude        │  │──────────► ANTHROPIC API
│  │   5. Parse citations    │  │
│  │   6. Write messages     │  │
│  │   7. Stream to client   │  │
│  │                         │  │
│  │  address.resolve:       │  │──────────► MAPBOX
│  │   - Geocode address     │  │
│  │   - Match jurisdictions │  │
│  └─────────────────────────┘  │
│                               │
│  ┌─────────────────────────┐  │
│  │     HTTP ACTIONS        │  │
│  │  (External REST access) │  │
│  │                         │  │
│  │  /api/query             │  │◄────── Called by CF Workers REST API
│  │  /api/jurisdictions     │  │◄────── or directly by external consumers
│  │  /api/address           │  │
│  └─────────────────────────┘  │
│                               │
└───────────────────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE (Data Pipeline)                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                     INGESTION ORCHESTRATOR                             │ │
│  │                    (Scheduled Worker - Cron)                           │ │
│  │                                                                        │ │
│  │   MVP:    Weekly re-scrape of all sources                             │ │
│  │   P1:     Daily LegiScan check for new bills (change alerts)          │ │
│  │   P1:     Daily Federal Register check (change alerts)                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                              │                                               │
│        ┌─────────────────────┼─────────────────────┐                        │
│        ▼                     ▼                     ▼                        │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐             │
│  │ API Ingester│    │ Scraper Worker  │    │ PDF Processor   │             │
│  │ Worker      │    │                 │    │ Worker (P1)     │             │
│  │             │    │ - Browserless/  │    │                 │             │
│  │ MVP:       │    │   Apify for     │    │ - Fetch from R2 │             │
│  │ - eCFR     │    │   JS rendering  │    │ - Extract text  │             │
│  │             │    │ - Cheerio for   │    │ - Chunk         │             │
│  │ P1:        │    │   static HTML   │    │ - Embed         │             │
│  │ - LegiScan │    │                 │    │                 │             │
│  │ - Fed Reg  │    │ MVP Sources:    │    │ (Only needed if │             │
│  │ - Congress │    │ - TX Statutes   │    │  county PDFs)   │             │
│  │            │    │ - TX Admin Code │    │                 │             │
│  │            │    │ - Municode      │    │                 │             │
│  │            │    │ - Am Legal      │    │                 │             │
│  └──────┬──────┘    └────────┬────────┘    └────────┬────────┘             │
│         │                    │                      │                       │
│         └────────────────────┴──────────────────────┘                       │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      CLOUDFLARE QUEUES                                 │ │
│  │                                                                        │ │
│  │   ingest-queue      - Raw documents to process                        │ │
│  │   embedding-queue   - Chunks to embed via OpenAI                      │ │
│  │   index-queue       - Embeddings to upsert into Pinecone              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────┐    ┌──────────────────────────────────┐    │
│  │       CLOUDFLARE R2         │    │          PINECONE                │    │
│  │      (Object Storage)       │    │       (Vector DB)               │    │
│  │                             │    │                                  │    │
│  │  /raw/federal/cfr/...       │    │  - Regulatory text chunks       │    │
│  │  /raw/tx/statutes/...       │    │  - 3072-dim embeddings          │    │
│  │  /raw/tx/admin-code/...     │    │  - Metadata filters:            │    │
│  │  /raw/tx/counties/...       │    │    jurisdiction_id              │    │
│  │  /raw/tx/cities/...         │    │    source_type                  │    │
│  │  /processed/chunks/...      │    │    activity_tags                │    │
│  │  /logs/ingestion/...        │    │    effective_date               │    │
│  └─────────────────────────────┘    └──────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Convex Schema

This is the application data model. Convex's schema gives type-safe queries/mutations and auto-generated TypeScript types for the frontend.

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ─── Users ─────────────────────────────────────────────────
  users: defineTable({
    clerkId: v.string(),          // Clerk auth provider ID
    email: v.string(),
    name: v.string(),
    organization: v.string(),     // "Costco Wholesale"
    role: v.string(),             // "compliance", "operations", "legal", "admin"
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"])
    .index("by_org", ["organization"]),

  // ─── Conversations ────────────────────────────────────────
  conversations: defineTable({
    userId: v.id("users"),
    title: v.optional(v.string()),          // Auto-generated or user-set
    address: v.optional(v.string()),        // If query was location-specific
    resolvedJurisdictions: v.optional(v.array(v.string())), // jurisdiction IDs
    activities: v.optional(v.array(v.string())),            // detected activities
    status: v.union(
      v.literal("active"),
      v.literal("archived")
    ),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"]),

  // ─── Messages ─────────────────────────────────────────────
  messages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system")
    ),
    content: v.string(),
    
    // Assistant-specific fields
    citations: v.optional(v.array(v.object({
      citation: v.string(),       // "Tex. Alco. Bev. Code § 22.01"
      url: v.string(),            // Link to source
      sourceType: v.string(),     // "statute", "regulation", "ordinance"
      jurisdiction: v.string(),   // "tx-state", "tx-houston"
      text: v.optional(v.string()), // Relevant excerpt
    }))),
    permits: v.optional(v.array(v.object({
      name: v.string(),
      agency: v.string(),
      url: v.optional(v.string()),
      estimatedCost: v.optional(v.string()),
      estimatedTimeline: v.optional(v.string()),
      jurisdiction: v.string(),
    }))),
    confidence: v.optional(v.number()),     // 0-1 confidence score
    processingTimeMs: v.optional(v.number()),
    chunksUsed: v.optional(v.number()),     // How many Pinecone results used
    
    status: v.union(
      v.literal("pending"),       // User sent, waiting for processing
      v.literal("processing"),    // Action running (geocoding, searching, etc.)
      v.literal("streaming"),     // LLM response streaming in
      v.literal("complete"),      // Done
      v.literal("error")          // Something failed
    ),
    errorMessage: v.optional(v.string()),
  })
    .index("by_conversation", ["conversationId"]),

  // ─── Jurisdictions ────────────────────────────────────────
  // Reference data — synced from Cloudflare pipeline
  jurisdictions: defineTable({
    jurisdictionId: v.string(),   // "federal", "tx-state", "tx-harris", "tx-houston"
    name: v.string(),             // "Harris County, TX"
    type: v.union(
      v.literal("federal"),
      v.literal("state"),
      v.literal("county"),
      v.literal("municipal")
    ),
    parentId: v.optional(v.string()),   // "tx-state" for counties
    state: v.optional(v.string()),      // "TX"
    fipsCode: v.optional(v.string()),
    coverage: v.union(
      v.literal("full"),
      v.literal("partial"),
      v.literal("none")
    ),
    lastUpdated: v.number(),      // Timestamp of last data refresh
  })
    .index("by_jurisdiction_id", ["jurisdictionId"])
    .index("by_type", ["type"])
    .index("by_parent", ["parentId"]),

  // ─── Data Sources ─────────────────────────────────────────
  // Tracks freshness of ingested data — updated by Cloudflare pipeline
  sources: defineTable({
    jurisdictionId: v.string(),
    name: v.string(),             // "Texas Alcoholic Beverage Code"
    sourceType: v.union(
      v.literal("statute"),
      v.literal("regulation"),
      v.literal("ordinance"),
      v.literal("guidance")
    ),
    url: v.string(),
    lastIngested: v.optional(v.number()),
    contentHash: v.optional(v.string()),  // For change detection
    chunkCount: v.optional(v.number()),   // Chunks in Pinecone
    status: v.union(
      v.literal("active"),
      v.literal("stale"),
      v.literal("error"),
      v.literal("pending")
    ),
  })
    .index("by_jurisdiction", ["jurisdictionId"])
    .index("by_status", ["status"]),

  // ─── Feedback ─────────────────────────────────────────────
  feedback: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
    rating: v.union(
      v.literal("helpful"),
      v.literal("not_helpful")
    ),
    comment: v.optional(v.string()),
  })
    .index("by_message", ["messageId"]),
});
```

---

## Convex Functions

### Queries (Real-time, reactive)

```typescript
// convex/conversations.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    let q = ctx.db
      .query("conversations")
      .withIndex("by_user_status", (q) => 
        q.eq("userId", user._id)
      );
    if (args.status) {
      q = q.filter((q) => q.eq(q.field("status"), args.status));
    }
    return await q.order("desc").collect();
  },
});

// convex/messages.ts
export const byConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
  },
});
```

### Mutations (Transactional writes)

```typescript
// convex/messages.ts
export const send = mutation({
  args: {
    conversationId: v.id("conversations"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getAuthUser(ctx);
    
    // Write user message
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: "user",
      content: args.content,
      status: "complete",
    });

    // Create placeholder for assistant response
    const assistantMessageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: "assistant",
      content: "",
      status: "pending",
    });

    // Kick off the query execution action
    await ctx.scheduler.runAfter(0, internal.query.execute, {
      conversationId: args.conversationId,
      messageId: assistantMessageId,
      userQuery: args.content,
    });

    return { messageId, assistantMessageId };
  },
});
```

### Actions (Server-side, external API calls)

```typescript
// convex/query.ts
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const execute = internalAction({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    userQuery: v.string(),
  },
  handler: async (ctx, args) => {
    // 1. Update status to processing
    await ctx.runMutation(internal.messages.updateStatus, {
      messageId: args.messageId,
      status: "processing",
    });

    try {
      // 2. Get conversation context (address, prior messages)
      const conversation = await ctx.runQuery(
        internal.conversations.getWithMessages,
        { conversationId: args.conversationId }
      );

      // 3. Resolve address to jurisdictions (if applicable)
      let jurisdictions = conversation.resolvedJurisdictions;
      if (!jurisdictions && detectAddress(args.userQuery)) {
        const resolved = await geocodeAndResolve(args.userQuery); // Mapbox
        jurisdictions = resolved.jurisdictionIds;
        
        await ctx.runMutation(internal.conversations.updateJurisdictions, {
          conversationId: args.conversationId,
          jurisdictions,
          address: resolved.formattedAddress,
        });
      }

      // 4. Build embedding and search Pinecone
      const embedding = await generateEmbedding(args.userQuery); // OpenAI
      const searchResults = await searchPinecone(embedding, {
        jurisdictionIds: jurisdictions,
        topK: 20,
      });

      // 5. Rerank results
      const reranked = await rerankResults(searchResults, args.userQuery);

      // 6. Build prompt with regulatory context
      const prompt = buildCompliancePrompt({
        userQuery: args.userQuery,
        context: reranked.slice(0, 10),
        conversationHistory: conversation.messages,
        jurisdictions,
      });

      // 7. Call Claude and stream response
      await ctx.runMutation(internal.messages.updateStatus, {
        messageId: args.messageId,
        status: "streaming",
      });

      const response = await callClaude(prompt); // Anthropic API

      // 8. Parse response for citations and permits
      const parsed = parseComplianceResponse(response);

      // 9. Write final message
      await ctx.runMutation(internal.messages.complete, {
        messageId: args.messageId,
        content: parsed.content,
        citations: parsed.citations,
        permits: parsed.permits,
        confidence: parsed.confidence,
        chunksUsed: reranked.length,
        processingTimeMs: Date.now() - startTime,
      });

    } catch (error) {
      await ctx.runMutation(internal.messages.updateStatus, {
        messageId: args.messageId,
        status: "error",
        errorMessage: error.message,
      });
    }
  },
});
```

### HTTP Actions (External REST access)

```typescript
// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/api/query",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Validate API key
    const apiKey = request.headers.get("X-API-Key");
    if (!await validateApiKey(apiKey)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const body = await request.json();
    
    // Run the same query logic as the chat UI
    const result = await ctx.runAction(internal.query.executeSync, {
      query: body.query,
      address: body.address,
      activities: body.activities,
    });

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

http.route({
  path: "/api/jurisdictions",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const jurisdictions = await ctx.runQuery(
      internal.jurisdictions.listAll
    );
    return new Response(JSON.stringify({ jurisdictions }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
```

---

## Frontend Integration

The React frontend connects to Convex directly. No proxy, no middleware.

```tsx
// src/App.tsx
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ClerkProvider, useAuth } from "@clerk/clerk-react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

function App() {
  return (
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_KEY}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ChatInterface />
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

// src/components/ChatInterface.tsx
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

function ChatInterface() {
  const conversations = useQuery(api.conversations.list, { status: "active" });
  const sendMessage = useMutation(api.messages.send);

  // conversations updates in real-time — no polling, no WebSockets
  // When the action writes a message, this component re-renders automatically

  return (
    <div>
      {conversations?.map((conv) => (
        <ConversationItem key={conv._id} conversation={conv} />
      ))}
    </div>
  );
}

// src/components/MessageList.tsx
function MessageList({ conversationId }) {
  const messages = useQuery(api.messages.byConversation, { conversationId });
  
  // Messages update in real-time as the action streams content
  // Status changes (pending → processing → streaming → complete) 
  // are reflected instantly in the UI

  return (
    <div>
      {messages?.map((msg) => (
        <Message key={msg._id} message={msg} />
      ))}
    </div>
  );
}
```

---

## Cloudflare Workers (Data Pipeline)

The data pipeline is independent of the application layer. It scrapes, processes, and indexes regulatory data into Pinecone + syncs metadata to Convex.

### Workers Architecture

```
workers/
├── ingestion-api/           # API-based ingestion (federal sources)
│   ├── src/
│   │   ├── index.ts
│   │   ├── sources/
│   │   │   ├── ecfr.ts
│   │   │   ├── federal-register.ts
│   │   │   ├── legiscan.ts
│   │   │   └── congress.ts
│   │   └── lib/
│   │       ├── chunker.ts
│   │       └── embedder.ts
│   └── wrangler.toml
│
├── ingestion-scraper/       # HTML scraping (state/local)
│   ├── src/
│   │   ├── index.ts
│   │   ├── scrapers/
│   │   │   ├── municode.ts
│   │   │   ├── american-legal.ts
│   │   │   ├── texas-statutes.ts
│   │   │   └── texas-admin-code.ts
│   │   └── lib/
│   │       └── browserless.ts  # Browserless.io client
│   └── wrangler.toml
│
├── embedding-worker/        # Generate embeddings, upsert to Pinecone
│   ├── src/
│   │   ├── index.ts         # Queue consumer
│   │   └── lib/
│   │       ├── openai.ts
│   │       └── pinecone.ts
│   └── wrangler.toml
│
├── sync-worker/             # Sync metadata to Convex
│   ├── src/
│   │   └── index.ts         # Updates sources + jurisdictions in Convex
│   └── wrangler.toml
│
├── external-api/            # REST API for external consumers (P2)
│   ├── src/
│   │   ├── index.ts         # Hono.js router
│   │   ├── routes/
│   │   │   ├── query.ts     # → Calls Convex HTTP Action
│   │   │   ├── jurisdictions.ts
│   │   │   └── health.ts
│   │   └── middleware/
│   │       ├── auth.ts      # API key validation
│   │       └── rateLimit.ts
│   └── wrangler.toml
│
└── scheduled/               # Cron triggers
    ├── src/
    │   └── index.ts
    └── wrangler.toml
```

### Sync Worker (Cloudflare → Convex)

After the pipeline ingests and indexes data, it syncs metadata to Convex so the application layer knows what's current:

```typescript
// workers/sync-worker/src/index.ts
import { ConvexHttpClient } from "convex/browser";

const convex = new ConvexHttpClient(CONVEX_URL);

async function syncSourceMetadata(source: IngestedSource) {
  // Update the sources table in Convex with freshness info
  await convex.mutation(api.internal.sources.upsert, {
    jurisdictionId: source.jurisdictionId,
    name: source.name,
    sourceType: source.sourceType,
    url: source.url,
    lastIngested: Date.now(),
    contentHash: source.contentHash,
    chunkCount: source.chunkCount,
    status: "active",
  });
}
```

---

## Pinecone Configuration

### Index Structure

```yaml
index_name: compliance-iq-prod
dimension: 3072  # text-embedding-3-large
metric: cosine
cloud: aws
region: us-east-1

# Metadata fields for filtering
metadata_config:
  indexed:
    - jurisdiction_id    # Filter by specific jurisdiction
    - jurisdiction_type  # Filter by level (federal/state/county/municipal)
    - source_type        # statute, regulation, ordinance, guidance
    - activity_tags      # Business activity categories
    - effective_date     # For temporal filtering
```

### Chunk Metadata Schema

```json
{
  "id": "chunk_tx_abc_22_01_001",
  "values": [0.123, -0.456, ...],
  "metadata": {
    "jurisdiction_id": "tx-state",
    "jurisdiction_type": "state",
    "jurisdiction_name": "Texas",
    "source_id": "tx-alcoholic-beverage-code",
    "source_type": "statute",
    "source_name": "Texas Alcoholic Beverage Code",
    "citation": "Tex. Alco. Bev. Code § 22.01",
    "section_title": "Authorized Activities",
    "chapter": "22",
    "section": "01",
    "activity_tags": ["alcohol_retail", "alcohol_spirits", "licensing"],
    "effective_date": "2023-09-01",
    "source_url": "https://statutes.capitol.texas.gov/Docs/AL/htm/AL.22.htm",
    "last_updated": "2026-01-15",
    "text_preview": "A package store permit authorizes the holder to purchase..."
  }
}
```

---

## Scraping Infrastructure

Cloudflare Workers can't run Playwright/Puppeteer. For JS-rendered sites (Municode), use an external rendering service.

### Recommended: Browserless.io

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  CF Worker       │     │  Browserless    │     │  CF Worker       │
│  (Trigger)       │────▶│  (Rendering)    │────▶│  (Processing)    │
│                  │     │                  │     │                  │
│  - Schedule      │     │  - Playwright   │     │  - Parse HTML    │
│  - Pick source   │     │  - Returns HTML │     │  - Chunk text    │
│  - Call API      │     │                  │     │  - Queue embed   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                                 ┌─────────────────┐
                                                 │  R2 + Pinecone  │
                                                 └─────────────────┘
```

### Alternative: Self-hosted on Railway/Fly.io

For higher volume or cost optimization, run a small scraping service:
1. Node.js + Playwright on Railway/Fly.io
2. Cron-triggered or API-triggered
3. Writes raw HTML/PDF to R2
4. Triggers Cloudflare Worker for processing

---

## Environment Configuration

### Convex Environment Variables

```bash
# Set via `npx convex env set`
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
PINECONE_INDEX=compliance-iq-prod
PINECONE_ENVIRONMENT=us-east-1
MAPBOX_ACCESS_TOKEN=pk...
CLERK_SECRET_KEY=sk_...
```

### Cloudflare Environment Variables

```bash
# Set via wrangler.toml or dashboard

# Shared secrets
OPENAI_API_KEY=sk-...
PINECONE_API_KEY=...
PINECONE_INDEX=compliance-iq-prod
LEGISCAN_API_KEY=...
BROWSERLESS_API_KEY=...
CONVEX_URL=https://your-project.convex.cloud
CONVEX_DEPLOY_KEY=...    # For server-to-server Convex calls

# R2 bindings (wrangler.toml)
[[r2_buckets]]
binding = "DOCUMENTS"
bucket_name = "compliance-iq-documents"

# Queue bindings (wrangler.toml)
[[queues.producers]]
binding = "INGEST_QUEUE"
queue = "ingest-queue"

[[queues.producers]]
binding = "EMBEDDING_QUEUE"
queue = "embedding-queue"
```

---

## Cost Estimates (Monthly)

| Service | Usage Estimate | Cost |
|---------|---------------|------|
| **Convex** | Free tier → Pro ($25/mo) | $0-$25 |
| **Clerk** (Auth) | Free tier (10K MAU) | $0 |
| **Cloudflare Workers** | 10M requests | ~$25 |
| **Cloudflare R2** | 50GB storage, 10M requests | ~$15 |
| **Cloudflare Queues** | 1M messages | ~$5 |
| **Pinecone** | Starter → Standard | $0-$70 |
| **Anthropic Claude** | ~500K queries × $0.003 avg | ~$1,500 |
| **OpenAI Embeddings** | ~10M tokens/mo | ~$13 |
| **Mapbox Geocoding** | 100K requests | $0 (free tier) |
| **Browserless.io** | 10K page renders | ~$50-100 |
| **LegiScan** | Paid tier if needed | $0-$500 |
| **Total MVP** | | **~$1,650-2,300/mo** |

Note: LLM costs dominate and scale with usage. Convex's caching and Cloudflare KV can reduce repeated LLM calls.

---

## Development Phases

### Phase 0: Research & Data Mapping (1-2 weeks)
- [ ] Complete URL/source inventory for Texas (see data sources doc)
- [ ] Test scraping each source type
- [ ] Confirm API access (LegiScan, Federal Register, etc.)
- [ ] Evaluate embedding models
- [ ] Set up Convex project, Cloudflare account, Pinecone index

### Phase 1: Foundation (2-3 weeks)
- [ ] Convex schema and seed data (jurisdictions, sources)
- [ ] Basic Convex functions (conversations, messages, queries)
- [ ] Federal data ingestion pipeline (Cloudflare Workers)
- [ ] Texas statutes ingestion
- [ ] Basic RAG pipeline (Convex action → Pinecone → Claude → message)
- [ ] React chat UI prototype connected to Convex

### Phase 2: Texas Coverage (3-4 weeks)
- [ ] Texas Admin Code ingestion
- [ ] County ordinances (top 10)
- [ ] City municipal codes (top 20)
- [ ] Address resolution with Mapbox (Convex action)
- [ ] Activity classification
- [ ] Citation linking
- [ ] Cloudflare → Convex sync worker

### Phase 3: Production Hardening (2-3 weeks)
- [ ] Streaming responses (Convex action → message updates)
- [ ] Caching layer (Cloudflare KV for repeated queries)
- [ ] Error handling & retry logic
- [ ] Monitoring & alerting
- [ ] Auth (Clerk + Convex)
- [ ] Feedback collection (thumbs up/down)

### Phase 4: Pilot (2-4 weeks)
- [ ] Costco user access
- [ ] Feedback collection and iteration
- [ ] Performance optimization
- [ ] External REST API (Cloudflare Workers) if needed
- [ ] API documentation

---

*Document version: 0.3*
*Last updated: January 31, 2026*
*Change log: Added MVP vs P1 annotations to data pipeline; clarified which API sources needed for MVP vs P1*
