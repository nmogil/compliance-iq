# PRD: Regulatory Compliance AI for US Retail Operations

## Product Name (Working): **ComplianceIQ** 

### Executive Summary

A conversational AI tool that answers the question: **"What laws, regulations, permits, and licenses do I need to [operate/sell X] at [specific address]?"** across federal, state, county, and municipal jurisdictions.

Initial customer: Costco Wholesale  
Initial scope: Single state pilot (recommended: **Texas** or **California**)

---

## Problem Statement

### The Pain

Opening and operating a retail warehouse in the US requires navigating compliance requirements across 4+ jurisdictional layers:

| Layer | Example Requirements |
|-------|---------------------|
| **Federal** | FDA registration, TTB (alcohol), DEA (pharmacy), OSHA, ADA, EEOC |
| **State** | Business registration, sales tax, alcohol (ABC), pharmacy board, food safety |
| **County** | Health department permits, building codes, fire marshal, weights & measures |
| **Municipal** | Business license, zoning, signage, parking, noise ordinances |

A single Costco warehouse selling groceries, alcohol, pharmacy, prepared food, gas, hearing aids, and optical might need **50+ distinct permits/licenses** from **15+ agencies**.

### Current State

- Costco uses **Codify AI** for Canadian operations - works well
- **No equivalent exists for US** - handled by legal teams, consultants, and tribal knowledge
- Compliance failures result in fines, operational delays, and reputational risk
- New warehouse openings require months of manual research

### Why Now

- LLMs + RAG make it newly feasible to parse, structure, and query regulatory text at scale
- Costco has expressed direct interest (John's "Holy Grail" comment)
- First-mover advantage in building the data layer = durable moat

---

## User Stories

### Primary Users

**1. Real Estate / Site Selection Team**
> "Before we sign a lease, I need to know what we can and can't do at this address."

**2. Compliance / Legal Team**  
> "What permits do we need to renew this quarter across all Texas locations?"

**3. Operations / Store Managers**
> "Can we start selling prepared sushi at this location? What do we need?"

**4. New Store Opening Team**
> "Give me a complete checklist of everything required to open a warehouse at [address]."

### Core User Flows

```
┌─────────────────────────────────────────────────────────────────┐
│  USER INPUT                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ "What do I need to sell recreational cannabis at        │    │
│  │  1234 Main St, Austin, TX 78701?"                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  SYSTEM PROCESSING                                               │
│                                                                  │
│  1. Geocode address → County (Travis), City (Austin)            │
│  2. Identify applicable jurisdictions                            │
│  3. Query knowledge base for "cannabis retail" across:          │
│     - Federal (still Schedule I - BLOCKER)                      │
│     - Texas state law (not legal - BLOCKER)                     │
│     - Travis County regulations                                  │
│     - Austin municipal code                                      │
│  4. Synthesize response with citations                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  OUTPUT                                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ ❌ NOT PERMITTED                                         │    │
│  │                                                          │    │
│  │ Recreational cannabis sales are not legal in Texas.     │    │
│  │                                                          │    │
│  │ Federal: Cannabis remains Schedule I (21 USC § 812)     │    │
│  │ State: Texas Health & Safety Code § 481.121 prohibits   │    │
│  │        possession/sale outside limited medical program   │    │
│  │                                                          │    │
│  │ [View source] [Track for changes]                       │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Architecture

### The Four-Layer Cake

```
┌────────────────────────────────────────────────────────────────────┐
│                        INTELLIGENCE LAYER                          │
│                    (LLM + RAG + Business Logic)                    │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │   FEDERAL    │  │    STATE     │  │    LOCAL     │            │
│  │              │  │              │  │              │            │
│  │ - USC        │  │ - Statutes   │  │ - County     │            │
│  │ - CFR        │  │ - Admin Code │  │ - Municipal  │            │
│  │ - Fed Reg    │  │ - Regs       │  │ - Ordinances │            │
│  │ - Agency     │  │ - Agency     │  │              │            │
│  │   guidance   │  │   guidance   │  │              │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│                         CHANGE TRACKING                            │
│              (LegiScan + Federal Register + Scrapers)              │
├────────────────────────────────────────────────────────────────────┤
│                        GEOGRAPHIC MAPPING                          │
│         (Address → Jurisdictions → Applicable Law)                 │
└────────────────────────────────────────────────────────────────────┘
```

### Data Sources & Ingestion Strategy

> **⚠️ MVP vs P1 Prioritization:** Many federal sources overlap. MVP only needs sources providing **current regulatory text**. Change tracking sources (Federal Register, LegiScan, etc.) are deferred to P1. See Data Sources doc for details.

#### Federal — MVP: eCFR Only

| Source | Data Type | Access Method | MVP/P1 | Notes |
|--------|-----------|---------------|--------|-------|
| [eCFR](https://www.ecfr.gov/developers) | Code of Federal Regulations | REST API | ✅ **MVP** | Daily updates, no auth required |
| [Federal Register API](https://www.federalregister.gov/developers) | Proposed/final rules | REST API | ⏳ P1 | Change tracking |
| [Regulations.gov API](https://open.gsa.gov/api/regulationsgov/) | Agency rulemaking | REST API | ⏳ P1 | Overlaps with Fed Reg |
| [Congress.gov API](https://api.congress.gov/) | Bills, laws | REST API | ⏳ P1 | Bills aren't law yet |
| [GovInfo](https://www.govinfo.gov/developers) | USC, CFR bulk data | Bulk download | ❌ Skip | Redundant with eCFR |

#### State Level — MVP: Statutes + Admin Code (Scraping)

| Source | Data Type | Access Method | MVP/P1 | Notes |
|--------|-----------|---------------|--------|-------|
| **Texas Statutes** | State law | Scraping | ✅ **MVP** | Static HTML, easy |
| **Texas Admin Code** | State regulations | Scraping | ✅ **MVP** | Use Cornell LII |
| **LegiScan** | Bill tracking | REST API | ⏳ P1 | Change alerts |
| **Texas Register** | Rule changes | Scraping | ⏳ P1 | Change alerts |

#### Local Level — MVP: City + County Ordinances (Scraping)

| Source | Data Type | Access Method | MVP/P1 | Notes |
|--------|-----------|---------------|--------|-------|
| **Municode/CivicPlus** | 4,200+ municipal codes | Scraping | ✅ **MVP** | Requires JS rendering |
| **American Legal Publishing** | ~3,000 codes | Scraping | ✅ **MVP** | Dallas, Fort Worth |
| **County websites** | Ordinances, permits | Scraping | ✅ **MVP** | Variable quality |

---

## Technical Approach: Data Ingestion

### When APIs Don't Exist: The Scraping Strategy

```python
# Conceptual architecture for regulatory data ingestion

class RegulatoryDataPipeline:
    """
    Multi-source ingestion pipeline that handles:
    - REST APIs (ideal)
    - Structured HTML scraping (common)
    - PDF extraction (frequent)
    - Manual entry (last resort)
    """
    
    def __init__(self):
        self.sources = {
            'api': APIIngester(),           # Federal sources, LegiScan
            'html': HTMLScraper(),          # Municode, state sites
            'pdf': PDFExtractor(),          # Admin codes, county docs
            'manual': ManualEntryQueue()    # Edge cases
        }
    
    def ingest_jurisdiction(self, jurisdiction_id: str):
        """
        For each jurisdiction, determine best source and method.
        """
        # 1. Check if API exists
        # 2. Fall back to structured HTML
        # 3. Fall back to PDF extraction
        # 4. Flag for manual review if unstructured
        pass
    
    def maintain_freshness(self):
        """
        Different strategies by source type:
        - APIs: Poll for changes (daily/weekly)
        - LegiScan: Track bills that modify existing code
        - Scraped: Re-scrape on schedule + monitor for site changes
        """
        pass
```

### PDF Extraction Strategy

Many state administrative codes and county regulations exist only as PDFs.

```
PDF Processing Pipeline:
                                                   
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Ingest  │───▶│   OCR    │───▶│  Parse   │───▶│  Chunk   │
│   PDF    │    │ (if scan)│    │ Structure│    │ + Embed  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                    │                │
                    ▼                ▼
              ┌──────────┐    ┌──────────┐
              │ Tesseract│    │ Document │
              │ / Azure  │    │   AI     │
              │   OCR    │    │ (GPT-4V) │
              └──────────┘    └──────────┘
```

---

## MVP Scope: Single State Pilot

### Recommended Pilot State: **Texas**

**Why Texas:**
- Large Costco presence (40+ warehouses)
- Complex regulatory environment (good stress test)
- Cannabis not legal (avoids federal preemption complexity for MVP)
- Mix of large metros (Houston, Dallas, Austin, San Antonio) and smaller markets
- State legislature meets every 2 years (simpler tracking than annual sessions)

### MVP Feature Set

| Feature | P0 (Launch) | P1 (Fast Follow) | P2 (Later) |
|---------|-------------|------------------|------------|
| Natural language queries | ✓ | | |
| Federal law coverage | ✓ | | |
| Texas state statutes | ✓ | | |
| Texas admin code | ✓ | | |
| Top 10 Texas counties | ✓ | | |
| Top 20 Texas cities | ✓ | | |
| Citation linking | ✓ | | |
| Real-time streaming responses | ✓ | | |
| Change alerts (LegiScan) | | ✓ | |
| Permit renewal tracking | | ✓ | |
| Multi-state expansion | | | ✓ |
| Compliance checklists | | | ✓ |
| Agency contact info | | | ✓ |
| External REST API (Costco integrations) | | | ✓ |

### MVP Data Coverage: Texas

#### State Level
- **Texas Statutes**: ~30 codes (Business & Commerce, Health & Safety, Alcoholic Beverage, Occupations, etc.)
- **Texas Administrative Code**: 16 titles, focus on:
  - Title 16: Economic Regulation (licensing)
  - Title 22: Examining Boards (pharmacy, optometry)
  - Title 25: Health Services (food safety)
  - Title 30: Environmental Quality
  - Title 37: Public Safety

#### Local Level (MVP)

**Counties (by Costco presence):**
1. Harris (Houston)
2. Dallas
3. Tarrant (Fort Worth)
4. Bexar (San Antonio)
5. Travis (Austin)
6. Collin (Plano)
7. Denton
8. El Paso
9. Fort Bend
10. Williamson

**Cities (by Costco presence + population):**
Houston, Dallas, San Antonio, Austin, Fort Worth, El Paso, Arlington, Plano, Corpus Christi, Lubbock, Laredo, Irving, Garland, Frisco, McKinney, Amarillo, Grand Prairie, Brownsville, Killeen, Pasadena

---

## Costco-Specific Business Activities

The system needs to understand Costco's specific operational categories:

```yaml
costco_business_activities:
  food_retail:
    - fresh_produce
    - fresh_meat_poultry
    - fresh_seafood
    - frozen_foods
    - bakery
    - deli_prepared_foods
    - dairy
    - packaged_goods
    
  food_service:
    - food_court_hot_food
    - food_court_pizza
    - sushi_preparation
    - rotisserie_chicken
    - cake_decorating
    
  alcohol:
    - beer_sales
    - wine_sales
    - spirits_sales
    - alcohol_tastings
    
  pharmacy:
    - prescription_dispensing
    - controlled_substances
    - immunizations
    - compounding
    
  optical:
    - eyeglass_sales
    - contact_lens_sales
    - optometry_services
    
  hearing:
    - hearing_aid_sales
    - hearing_tests
    
  fuel:
    - gasoline_retail
    - diesel_retail
    - underground_storage_tanks
    
  tire_service:
    - tire_sales
    - tire_installation
    - tire_disposal
    
  photo:
    - photo_processing
    - passport_photos
    
  general_operations:
    - employment
    - signage
    - parking
    - waste_disposal
    - fire_safety
    - accessibility
```

---

## Technical Architecture

### Hybrid Architecture: Convex + Cloudflare

The system uses a **hybrid architecture** with clear separation of concerns:

- **Convex (https://convex.dev)** — Application layer: chat, conversations, real-time UI, auth, query orchestration
- **Cloudflare** — Data pipeline: scraping, ingestion, document storage, external REST API
- **Pinecone** — Vector database: regulatory text embeddings and metadata-filtered search

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACES                             │
│                                                                          │
│    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐            │
│    │  Chat UI     │    │  Compliance  │    │  External    │            │
│    │  (React)     │    │  Dashboard   │    │  REST API    │            │
│    │              │    │  (React)     │    │  (Costco)    │            │
│    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘            │
│           │                   │                   │                     │
│           │  Convex SDK       │  Convex SDK       │  HTTP              │
│           │  (direct)         │  (direct)         │                     │
└───────────┼───────────────────┼───────────────────┼─────────────────────┘
            │                   │                   │
            ▼                   ▼                   ▼
┌───────────────────────────────────┐    ┌────────────────────────────────┐
│          CONVEX                    │    │    CLOUDFLARE WORKERS          │
│     (Application Layer)           │    │    (External REST API +        │
│                                    │    │     Data Pipeline)             │
│  - Conversations & messages       │    │                                │
│  - Real-time subscriptions        │    │  REST: /v1/query, etc.        │
│  - User auth                      │    │  Scraping + Ingestion         │
│  - Query orchestration            │    │  R2 document storage          │
│  - Pinecone search (actions)      │    │  Cron jobs (LegiScan, etc.)  │
│  - Claude LLM calls (actions)     │    │                                │
│  - Streaming responses            │    │  → Calls Convex HTTP Actions  │
│                                    │    │    for shared logic           │
└──────────────┬─────────────────────┘    └───────────────┬───────────────┘
               │                                          │
               └──────────────┬───────────────────────────┘
                              │
                              ▼
                       ┌─────────────┐
                       │  PINECONE   │
                       │  (Vectors)  │
                       └─────────────┘
```

### Why This Split

| Concern | Convex | Cloudflare | Why |
|---------|--------|------------|-----|
| Chat/conversations | ✓ | | Real-time subscriptions, no WebSocket plumbing |
| User auth | ✓ | | Built-in, integrates with Clerk/Auth0 |
| Query orchestration | ✓ | | Actions call Pinecone + Claude, stream results |
| Relational data | ✓ | | Type-safe schema, reactive queries |
| Scraping/ingestion | | ✓ | Batch work, cron, Workers + Queues |
| Raw document storage | | ✓ | R2 is cheap object storage |
| External REST API | | ✓ | API key auth, rate limiting, OpenAPI spec |
| Vector search | Pinecone | Pinecone | Both layers query Pinecone directly |

### Tech Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Frontend** | React + Tailwind | Standard, fast iteration |
| **Application Backend** | Convex | Real-time, type-safe, serverless |
| **Data Pipeline** | Cloudflare Workers + R2 + Queues | Batch processing, scraping, cron |
| **External API** | Cloudflare Workers (Hono.js) | REST for external consumers |
| **Vector DB** | Pinecone | Managed, scales well, metadata filtering |
| **LLM** | Claude (Anthropic) | Best for complex reasoning, citations |
| **Embeddings** | OpenAI text-embedding-3-large | High quality, 3072 dims |
| **Scraping** | Browserless.io / Apify | Managed Playwright for JS-rendered sites |
| **PDF Processing** | Unstructured.io + Azure Doc AI | Handles complex layouts |
| **Geocoding** | Mapbox | Address → jurisdiction mapping |
| **Change Tracking** | LegiScan API | Industry standard for bill tracking |

---

## Risk & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Data accuracy** - wrong legal info | High | Critical | Human review for high-stakes queries, confidence scoring, clear disclaimers |
| **Data freshness** - outdated law | Medium | High | LegiScan alerts, scheduled re-scrapes, "as of" dating |
| **Scraper breakage** - site changes | High | Medium | Monitoring, alerts, multiple source fallbacks |
| **Liability** - user relies on bad info | Medium | Critical | Terms of service, "not legal advice" disclaimers, professional review tier |
| **Scope creep** - too many states too fast | Medium | Medium | Strict MVP scope, quality gates before expansion |
| **Municipal data gaps** - small towns | High | Low | Flag coverage gaps clearly, prioritize by Costco presence |

---

## Success Metrics

### MVP Success Criteria (Texas Pilot)

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Query accuracy** | >90% correct | Human evaluation of 100 sample queries |
| **Coverage** | 100% of TX Costco jurisdictions | Audit of all locations |
| **Response time** | <10 seconds | P95 latency |
| **User satisfaction** | >4/5 rating | Post-query feedback |
| **Citation accuracy** | >95% valid links | Automated link checking |

### Business Metrics

| Metric | Baseline | Target |
|--------|----------|--------|
| Time to answer compliance question | 2-4 hours (manual) | <2 minutes |
| New store opening compliance timeline | 3-6 months | 1-2 months |
| Compliance-related fines/issues | TBD | 50% reduction |

---

## Timeline (Estimated)

### Phase 1: Foundation (Weeks 1-4)
- [ ] Convex project setup + schema
- [ ] Federal data ingestion pipeline (Cloudflare Workers)
- [ ] Texas statutes ingestion (scraping)
- [ ] Basic RAG pipeline working (Convex action → Pinecone → Claude)
- [ ] Proof of concept chat interface (React + Convex)

### Phase 2: Texas Coverage (Weeks 5-10)
- [ ] Texas Administrative Code ingestion
- [ ] Top 10 county ordinance scraping
- [ ] Top 20 city municipal code scraping
- [ ] Geocoding integration (Mapbox)
- [ ] Activity classifier training

### Phase 3: Polish & Pilot (Weeks 11-14)
- [ ] Citation linking & validation
- [ ] Confidence scoring
- [ ] User feedback loop
- [ ] Costco pilot users (5-10)
- [ ] Iterate based on feedback

### Phase 4: Production (Weeks 15-18)
- [ ] Full Texas coverage
- [ ] Change tracking alerts
- [ ] Dashboard for compliance team
- [ ] External REST API (Cloudflare Workers) for Costco integrations
- [ ] Security review
- [ ] Production deployment

---

## Open Questions

1. **Costco engagement model**: Build as a product they buy, or partner/co-develop?
2. **Liability structure**: How do we protect against reliance on incorrect info?
3. **Expansion sequencing**: After Texas, which states? (CA, WA, FL likely candidates)
4. **Pricing model**: Per-seat SaaS? Per-query? Enterprise license?
5. **Build vs. partner**: Any existing data providers worth partnering with (MultiState, etc.)?
6. **Data licensing**: Any restrictions on commercial use of scraped government data?

---

## Next Steps

1. **Validate with John (Costco)**: Share this PRD, get feedback on priorities and pain points
2. **Technical spike**: Build proof-of-concept with federal + Texas statutes in 1-2 weeks
3. **Data audit**: Map exact sources and accessibility for Texas MVP scope
4. **Legal review**: Confirm data usage rights, liability structure
5. **Decision**: Go/no-go on full MVP build

---

*Document version: 0.3*
*Last updated: January 31, 2026*
*Change log: Added MVP vs P1 prioritization for data sources; clarified that only eCFR needed for federal MVP*
