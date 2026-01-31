# Data Source Inventory: Texas Pilot

## Research Phase Document

This document catalogs every data source needed for the Texas MVP, including exact URLs, access methods, data formats, and known challenges.

**Architecture context:** Data is ingested by **Cloudflare Workers**, stored raw in **Cloudflare R2**, embedded and indexed in **Pinecone**, and metadata synced to **Convex** for the application layer. See the Technical Architecture doc for details.

---

## ⚠️ MVP vs P1 Data Sources — READ THIS FIRST

There is **significant overlap** between federal data sources. For MVP, we only need sources that provide **current regulatory text**. Change tracking sources are deferred to P1.

### MVP Sources (4 total) — BUILD THESE FIRST

These sources answer: **"What laws apply right now?"**

| # | Source | Type | Access | Auth Required |
|---|--------|------|--------|---------------|
| 1 | **eCFR** | Federal regulations | REST API | None |
| 2 | **Texas Statutes** | State law | Scrape (static HTML) | None |
| 3 | **Texas Admin Code** | State regulations | Scrape | None |
| 4 | **Local Ordinances** | City/county rules | Scrape (JS rendering) | None |

### P1 Sources (Deferred) — Change Tracking & Alerts

These sources answer: **"What's changing?"** — needed for the P1 "alert me when rules change" feature.

| Source | What It Provides | Why Defer |
|--------|------------------|-----------|
| Federal Register | Proposed/final federal rule changes | Change tracking, not current law |
| LegiScan | Texas bill tracking | Pending legislation, not current law |
| Congress.gov | Federal bill tracking | Same — bills aren't law yet |
| Regulations.gov | Agency rulemaking comments | Supplementary detail |
| GovInfo | Bulk CFR/USC downloads | Redundant with eCFR API |
| Texas Register | Proposed state rule changes | Change tracking for TAC |

### Data Overlap Explained

```
┌─────────────────────────────────────────────────────────────────┐
│                     FEDERAL DATA OVERLAP                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   GovInfo (bulk)  ──────┐                                       │
│   (SKIP - redundant)    ├──►  CFR Text  ◄──── eCFR (USE THIS)   │
│                         │     (same data)     (daily updates)   │
│                         │                                       │
│   Federal Register ─────┼──►  Rule Changes   (P1 - alerts)      │
│   Regulations.gov ──────┘     (defer)                           │
│                                                                 │
│   Congress.gov ─────────────►  Federal Bills  (P1 - alerts)     │
│                               (defer)                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Source Summary

| Layer | MVP Sources | P1 Sources | Access Method |
|-------|-------------|------------|---------------|
| Federal | 1 (eCFR) | 4 (Fed Reg, Regs.gov, Congress, GovInfo) | APIs |
| Texas State | 2 (Statutes, TAC) | 2 (LegiScan, TX Register) | Scrape + API |
| Texas Counties (10) | 10 | — | Scrape |
| Texas Cities (20) | 20 | — | Scrape |
| **MVP Total** | **33** | | |

### Data Flow

```
Sources → Cloudflare Workers (scrape/fetch) → R2 (raw storage)
       → Cloudflare Workers (chunk/embed)  → Pinecone (vectors)
       → Cloudflare Sync Worker            → Convex (metadata: freshness, coverage)
```

---

## 1. Federal Sources

### 1.1 Code of Federal Regulations (eCFR) — ✅ MVP

**Primary Source - USE THIS FOR MVP**
| Field | Value |
|-------|-------|
| URL | https://www.ecfr.gov/ |
| API Documentation | https://www.ecfr.gov/developers/documentation/api/v1 |
| Interactive API Docs | https://www.ecfr.gov/reader-aids/ecfr-developer-resources/rest-api-interactive-documentation |
| Format | JSON, XML |
| Access | Free, no API key required |
| Update Frequency | Daily |
| Coverage | All 50 CFR titles |

**Key Endpoints:**
```
GET /api/versioner/v1/titles
GET /api/versioner/v1/titles/{title}/versions
GET /api/versioner/v1/full/{date}/title-{title}.xml
GET /api/search/v1/results?query={query}
```

**Relevant CFR Titles for Costco:**
- Title 7: Agriculture (food safety)
- Title 9: Animals and Animal Products (meat inspection)
- Title 21: Food and Drugs (FDA regulations)
- Title 27: Alcohol, Tobacco Products and Firearms (TTB)
- Title 29: Labor (OSHA, employment)
- Title 40: Protection of Environment (EPA)
- Title 49: Transportation (hazmat, fuel)

**Notes:**
- eCFR is updated daily (unlike annual print CFR)
- API provides point-in-time access to historical versions
- Bulk XML available via GovInfo

---

### 1.2 Federal Register — ⏳ P1 (Change Tracking)

**Deferred to P1 — Used for "alert me when rules change" feature**
| Field | Value |
|-------|-------|
| URL | https://www.federalregister.gov/ |
| API Documentation | https://www.federalregister.gov/developers/documentation/api/v1 |
| REST API Base | https://www.federalregister.gov/api/v1/ |
| Format | JSON, CSV |
| Access | Free, no API key required |
| Update Frequency | Daily (business days) |

**Key Endpoints:**
```
GET /api/v1/documents
GET /api/v1/documents/{document_number}
GET /api/v1/public-inspection-documents
```

**Use Case:** Track proposed rules and final rules that will change CFR. Good for "what's changing" alerts.

---

### 1.3 Regulations.gov — ⏳ P1 (Change Tracking)

**Deferred to P1 — Overlaps with Federal Register for rulemaking**
| Field | Value |
|-------|-------|
| URL | https://www.regulations.gov/ |
| API Documentation | https://open.gsa.gov/api/regulationsgov/ |
| API Base | https://api.regulations.gov/v4/ |
| Format | JSON |
| Access | Free API key required |
| Rate Limit | 1,000 requests/hour |

**Registration:**
- Sign up at: https://open.gsa.gov/api/regulationsgov/
- API key sent via email

**Key Endpoints:**
```
GET /v4/documents?filter[searchTerm]={query}
GET /v4/documents/{documentId}
GET /v4/dockets/{docketId}
GET /v4/comments
```

**Use Case:** Agency rulemaking, public comments, supporting documents.

---

### 1.4 Congress.gov API — ⏳ P1 (Change Tracking)

**Deferred to P1 — Bills aren't law until passed; use for legislative alerts**
| Field | Value |
|-------|-------|
| URL | https://www.congress.gov/ |
| API Documentation | https://api.congress.gov/ |
| API Base | https://api.congress.gov/v3/ |
| Format | JSON, XML |
| Access | Free API key required |
| Rate Limit | 5,000 requests/day |

**Registration:**
- Sign up at: https://api.congress.gov/sign-up/

**Key Endpoints:**
```
GET /bill
GET /bill/{congress}/{billType}/{billNumber}
GET /law/{congress}
```

**Use Case:** Track federal bills that may impact retail operations.

---

### 1.5 GovInfo (Bulk Data) — ❌ SKIP (Redundant)

**Not needed — eCFR API provides the same CFR data with daily updates**
| Field | Value |
|-------|-------|
| URL | https://www.govinfo.gov/ |
| Bulk Data | https://www.govinfo.gov/bulkdata |
| API Documentation | https://api.govinfo.gov/docs/ |
| Format | XML, PDF |
| Access | Free |

**Bulk Collections:**
- CFR: https://www.govinfo.gov/bulkdata/CFR
- USCODE: https://www.govinfo.gov/bulkdata/USCODE
- FR: https://www.govinfo.gov/bulkdata/FR

**Use Case:** Initial bulk load of federal law, annual refresh.

---

## 2. Texas State Sources

### 2.1 Texas Statutes — ✅ MVP

**Primary Source — Core state law for MVP**
| Field | Value |
|-------|-------|
| URL | https://statutes.capitol.texas.gov/ |
| Browse by Code | https://statutes.capitol.texas.gov/Index.aspx |
| Format | HTML |
| Access | Scraping required |
| Update Frequency | After legislative sessions |
| Current Through | 89th Regular Session (2025) |

**URL Pattern:**
```
https://statutes.capitol.texas.gov/Docs/{CODE}/htm/{CODE}.{CHAPTER}.htm

Examples:
- Health & Safety Code Ch. 431: https://statutes.capitol.texas.gov/Docs/HS/htm/HS.431.htm
- Alcoholic Beverage Code Ch. 22: https://statutes.capitol.texas.gov/Docs/AL/htm/AL.22.htm
- Occupations Code Ch. 558: https://statutes.capitol.texas.gov/Docs/OC/htm/OC.558.htm
```

**Texas Codes (All 28):**
| Code | Abbreviation | Relevance to Costco |
|------|--------------|---------------------|
| Agriculture Code | AGRIC | ⭐⭐ Food safety |
| Alcoholic Beverage Code | AL | ⭐⭐⭐ Liquor licensing |
| Business & Commerce Code | BC | ⭐⭐ General business |
| Business Organizations Code | BO | ⭐ Corporate structure |
| Civil Practice and Remedies | CP | ⭐ Liability |
| Education Code | ED | - |
| Election Code | EL | - |
| Estates Code | ES | - |
| Family Code | FA | - |
| Finance Code | FI | ⭐ Banking, credit |
| Government Code | GV | ⭐⭐ Public contracts |
| Health and Safety Code | HS | ⭐⭐⭐ Food, pharmacy, safety |
| Human Resources Code | HR | ⭐ Employment |
| Insurance Code | IN | ⭐ Insurance requirements |
| Labor Code | LA | ⭐⭐ Employment law |
| Local Government Code | LG | ⭐⭐ Municipal powers |
| Natural Resources Code | NR | ⭐ Environmental |
| Occupations Code | OC | ⭐⭐⭐ Professional licensing |
| Parks and Wildlife Code | PW | - |
| Penal Code | PE | ⭐ Criminal penalties |
| Property Code | PR | ⭐ Real estate |
| Special District Local Laws | SD | - |
| Tax Code | TX | ⭐⭐ Sales tax |
| Transportation Code | TN | ⭐ Fleet, fuel |
| Utilities Code | UT | ⭐ Energy |
| Water Code | WA | ⭐ Environmental |

**Alternative Sources:**
- Justia (free): https://law.justia.com/codes/texas/
- Cornell LII (free): https://www.law.cornell.edu/states/texas
- FindLaw (free): https://codes.findlaw.com/tx/

**Scraping Strategy:**
1. Index page lists all codes: https://statutes.capitol.texas.gov/Index.aspx
2. Each code has chapters listed
3. Each chapter is a single HTML page with all sections
4. Parse HTML, extract section numbers, titles, and text
5. Store raw in R2, process via Cloudflare Workers, embed and index in Pinecone

---

### 2.2 Texas Administrative Code (TAC) — ✅ MVP

**Primary Source — State agency regulations for MVP**
| Field | Value |
|-------|-------|
| URL | https://www.sos.state.tx.us/tac/index.shtml |
| New Portal | https://texas-sos.appianportalsgov.com/rules-and-meetings?interface=VIEW_TAC |
| Format | HTML |
| Access | Scraping required |
| Update Frequency | Continuous (rules adopted via Texas Register) |

**Alternative Source (Better for Scraping):**
- Cornell LII: https://www.law.cornell.edu/regulations/texas

**TAC Structure:**
```
Title → Part → Chapter → Subchapter → Section

Example: 25 TAC § 229.1
- Title 25: Health Services
- Part 1: Department of State Health Services
- Chapter 229: Food Establishments
- Section 229.1: Definitions
```

**Relevant TAC Titles:**
| Title | Name | Relevance |
|-------|------|-----------|
| 1 | Administration | ⭐ General |
| 4 | Agriculture | ⭐⭐ Weights & measures |
| 7 | Banking and Securities | ⭐ Financial |
| 16 | Economic Regulation | ⭐⭐⭐ Licensing (ABC, pharmacy boards) |
| 22 | Examining Boards | ⭐⭐⭐ Professional licenses (pharmacy, optometry) |
| 25 | Health Services | ⭐⭐⭐ Food safety, health permits |
| 28 | Insurance | ⭐ Insurance requirements |
| 30 | Environmental Quality | ⭐⭐ TCEQ permits |
| 34 | Public Finance | ⭐ Tax |
| 37 | Public Safety and Corrections | ⭐⭐ Fire marshal |
| 40 | Social Services and Assistance | ⭐ Employment |
| 43 | Transportation | ⭐ Fleet |

**Scraping Challenges:**
- Legacy site uses ASP.NET with ViewState
- New Appian portal may be harder to scrape
- Consider using Cornell LII as primary source for cleaner HTML

---

### 2.3 Texas Register (Rule Changes) — ⏳ P1 (Change Tracking)

**Deferred to P1 — Track proposed/adopted rules that will modify TAC**
| Field | Value |
|-------|-------|
| URL | https://www.sos.state.tx.us/texreg/index.shtml |
| Format | PDF, HTML |
| Access | Free |
| Update Frequency | Weekly (Fridays) |

**Use Case:** Track proposed and adopted rules that will modify TAC.

---

### 2.4 LegiScan (Bill Tracking) — ⏳ P1 (Change Tracking)

**Deferred to P1 — Bills aren't law until passed; use for legislative alerts**
| Field | Value |
|-------|-------|
| URL | https://legiscan.com/ |
| API Documentation | https://legiscan.com/legiscan |
| API User Manual | https://api.legiscan.com/dl/LegiScan_API_User_Manual.pdf |
| Format | JSON |
| Access | Free tier: 30K queries/month |
| Texas Dataset | https://legiscan.com/datasets?state=TX |

**API Key Registration:**
- Sign up: https://legiscan.com/legiscan-register
- Free account gives API access

**Key Endpoints:**
```
getMasterList - Get all bills in current session
getBill - Get detailed bill info
getSearch - Full text search
getSessionList - Available sessions
```

**Use Case:** Track bills that will modify Texas statutes. Alert when legislation affecting retail operations is introduced. Run as a scheduled Cloudflare Worker (daily cron).

---

## 3. Texas County Sources (Top 10) — ✅ MVP

Counties have more limited ordinance-making power than cities in Texas. Focus on:
- Health regulations
- Building codes
- Environmental permits
- Business registrations

### 3.1 Harris County (Houston)

| Field | Value |
|-------|-------|
| Costco Locations | ~15 |
| Population | 4.7M |
| Ordinances URL | https://harriscounty.municipalcodeonline.com/ |
| Publisher | Municipal Code Online |
| Format | HTML |
| Additional | https://cao.harriscountytx.gov/harris-county-regulations |

**Key Departments:**
- Harris County Public Health: https://publichealth.harriscountytx.gov/
- Fire Marshal: https://fmo.harriscountytx.gov/
- Permits: https://oce.harriscountytx.gov/

---

### 3.2 Dallas County

| Field | Value |
|-------|-------|
| Costco Locations | ~8 |
| Population | 2.6M |
| Ordinances URL | https://www.dallascounty.org/government/commissioners-court/court-orders.php |
| Format | PDF (Court Orders) |

**Note:** Dallas County publishes court orders rather than a unified code. Harder to scrape.

---

### 3.3 Tarrant County (Fort Worth)

| Field | Value |
|-------|-------|
| Costco Locations | ~6 |
| Population | 2.1M |
| Ordinances URL | Check county website |
| County Website | https://www.tarrantcountytx.gov/ |

---

### 3.4 Bexar County (San Antonio)

| Field | Value |
|-------|-------|
| Costco Locations | ~5 |
| Population | 2.0M |
| County Website | https://www.bexar.org/ |

---

### 3.5 Travis County (Austin)

| Field | Value |
|-------|-------|
| Costco Locations | ~4 |
| Population | 1.3M |
| County Website | https://www.traviscountytx.gov/ |

---

### 3.6 Collin County (Plano/McKinney)

| Field | Value |
|-------|-------|
| Costco Locations | ~3 |
| Population | 1.1M |
| County Website | https://www.collincountytx.gov/ |

---

### 3.7 Denton County

| Field | Value |
|-------|-------|
| Costco Locations | ~2 |
| Population | 900K |
| County Website | https://www.dentoncounty.gov/ |

---

### 3.8 Fort Bend County

| Field | Value |
|-------|-------|
| Costco Locations | ~2 |
| Population | 850K |
| County Website | https://www.fortbendcountytx.gov/ |

---

### 3.9 Williamson County

| Field | Value |
|-------|-------|
| Costco Locations | ~2 |
| Population | 650K |
| County Website | https://www.wilco.org/ |

---

### 3.10 El Paso County

| Field | Value |
|-------|-------|
| Costco Locations | ~2 |
| Population | 850K |
| County Website | https://www.epcounty.com/ |

---

## 4. Texas City Sources (Top 20) — ✅ MVP

Cities have broader ordinance powers in Texas. Focus on:
- Business licenses
- Zoning (note: Houston has no traditional zoning)
- Health permits
- Alcohol permits
- Signage
- Fire codes
- Building codes

### 4.1 Houston

| Field | Value |
|-------|-------|
| Population | 2.3M |
| Ordinances URL | https://library.municode.com/tx/houston/codes/code_of_ordinances |
| City Website | https://www.houstontx.gov/codes/ |
| Publisher | Municode |
| Format | HTML |

**Key Chapters:**
- Chapter 3: Alcoholic Beverages
- Chapter 10: Buildings and Neighborhood Protection
- Chapter 20: Food and Food Handlers
- Chapter 28: Miscellaneous Offenses and Provisions
- Chapter 30: Motor Vehicles and Traffic

---

### 4.2 San Antonio

| Field | Value |
|-------|-------|
| Population | 1.5M |
| Ordinances URL | https://library.municode.com/tx/san_antonio/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.3 Dallas

| Field | Value |
|-------|-------|
| Population | 1.3M |
| Ordinances URL | https://codelibrary.amlegal.com/codes/dallas/latest/overview |
| City Website | https://dallascityhall.com/government/Pages/city-codes.aspx |
| Publisher | American Legal Publishing |

---

### 4.4 Austin

| Field | Value |
|-------|-------|
| Population | 1.0M |
| Ordinances URL | https://library.municode.com/tx/austin/codes/code_of_ordinances |
| Alt URL | https://codelibrary.amlegal.com/codes/austin/latest/overview |
| Publisher | Both Municode and American Legal |

---

### 4.5 Fort Worth

| Field | Value |
|-------|-------|
| Population | 950K |
| Ordinances URL | https://codelibrary.amlegal.com/codes/ftworth/latest/overview |
| Publisher | American Legal Publishing |

---

### 4.6 El Paso

| Field | Value |
|-------|-------|
| Population | 680K |
| Ordinances URL | https://library.municode.com/tx/el_paso/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.7 Arlington

| Field | Value |
|-------|-------|
| Population | 400K |
| Ordinances URL | https://library.municode.com/tx/arlington/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.8 Plano

| Field | Value |
|-------|-------|
| Population | 290K |
| Ordinances URL | https://library.municode.com/tx/plano/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.9 Corpus Christi

| Field | Value |
|-------|-------|
| Population | 320K |
| Ordinances URL | https://library.municode.com/tx/corpus_christi/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.10 Lubbock

| Field | Value |
|-------|-------|
| Population | 260K |
| Ordinances URL | https://library.municode.com/tx/lubbock/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.11 Laredo

| Field | Value |
|-------|-------|
| Population | 260K |
| Ordinances URL | https://library.municode.com/tx/laredo/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.12 Irving

| Field | Value |
|-------|-------|
| Population | 250K |
| Ordinances URL | https://library.municode.com/tx/irving/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.13 Garland

| Field | Value |
|-------|-------|
| Population | 240K |
| Ordinances URL | https://library.municode.com/tx/garland/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.14 Frisco

| Field | Value |
|-------|-------|
| Population | 220K |
| Ordinances URL | https://library.municode.com/tx/frisco/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.15 McKinney

| Field | Value |
|-------|-------|
| Population | 200K |
| Ordinances URL | https://library.municode.com/tx/mckinney/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.16 Amarillo

| Field | Value |
|-------|-------|
| Population | 200K |
| Ordinances URL | https://library.municode.com/tx/amarillo/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.17 Grand Prairie

| Field | Value |
|-------|-------|
| Population | 195K |
| Ordinances URL | https://library.municode.com/tx/grand_prairie/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.18 Brownsville

| Field | Value |
|-------|-------|
| Population | 190K |
| Ordinances URL | Check city website |
| Publisher | Varies |

---

### 4.19 Killeen

| Field | Value |
|-------|-------|
| Population | 155K |
| Ordinances URL | https://library.municode.com/tx/killeen/codes/code_of_ordinances |
| Publisher | Municode |

---

### 4.20 Pasadena

| Field | Value |
|-------|-------|
| Population | 150K |
| Ordinances URL | https://library.municode.com/tx/pasadena/codes/code_of_ordinances |
| Publisher | Municode |

---

## 5. Scraping Strategy by Publisher

### 5.1 Municode (Majority of Cities)

**Base URL Pattern:**
```
https://library.municode.com/{state}/{city}/codes/code_of_ordinances
```

**Structure:**
- Table of contents in sidebar
- Each section has unique nodeId in URL
- Clean HTML with consistent class names

**Example URL:**
```
https://library.municode.com/tx/houston/codes/code_of_ordinances?nodeId=COOR_CH3AM
```

**Scraping Approach:**
1. Fetch TOC to get all chapter/section nodeIds
2. Iterate through each section
3. Extract title, section number, text content
4. Handle nested structures (articles, divisions)
5. Store raw HTML in Cloudflare R2
6. Process via Cloudflare Workers (chunk, embed, index to Pinecone)

**Rate Limiting:**
- Respect robots.txt
- 1-2 second delays between requests
- Consider reaching out for data partnership

---

### 5.2 American Legal Publishing (Dallas, Fort Worth, Austin)

**Base URL Pattern:**
```
https://codelibrary.amlegal.com/codes/{city}/latest/{path}
```

**Structure:**
- Similar tree navigation
- Clean HTML
- Section content in main panel

---

### 5.3 Municipal Code Online (Harris County)

**Base URL:**
```
https://harriscounty.municipalcodeonline.com/
```

---

### 5.4 State Government Sites (Texas Statutes, TAC)

**Capitol.texas.gov:**
- Static HTML pages
- Predictable URL structure
- No JavaScript required — Cloudflare Workers can fetch directly (no Browserless needed)

**SOS.state.tx.us (TAC):**
- ASP.NET with ViewState
- May require session handling
- Consider Cornell LII as alternative: https://www.law.cornell.edu/regulations/texas

---

## 6. Data Processing Pipeline

### 6.1 Ingestion Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE DATA PIPELINE                     │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   API Sources │    │ Scrape HTML   │    │ Scrape PDF    │
│  (CF Workers) │    │ (CF Workers + │    │ (CF Workers)  │
│               │    │  Browserless) │    │               │
│ - eCFR        │    │ - TX Statutes │    │ - TX Admin    │
│ - Fed Reg     │    │ - Municode    │    │   (some)      │
│ - LegiScan    │    │ - Am Legal    │    │ - County docs │
│ - Regs.gov    │    │ - TAC         │    │               │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        └────────────────────┴────────────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │    RAW STORAGE      │
                  │   (Cloudflare R2)   │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │     PROCESSING      │
                  │   (CF Workers +     │
                  │    CF Queues)       │
                  │                     │
                  │ - Parse structure   │
                  │ - Extract citations │
                  │ - Chunk text        │
                  │ - Add metadata      │
                  └──────────┬──────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │     EMBEDDING       │
                  │   (CF Workers →     │
                  │    OpenAI API)      │
                  │                     │
                  │ - text-embedding-   │
                  │   3-large           │
                  │ - 3072 dimensions   │
                  └──────────┬──────────┘
                             │
                     ┌───────┴───────┐
                     │               │
                     ▼               ▼
          ┌─────────────────┐ ┌─────────────┐
          │    PINECONE     │ │   CONVEX    │
          │   (Vectors +    │ │  (Metadata  │
          │    Metadata)    │ │   sync)     │
          └─────────────────┘ └─────────────┘
```

### 6.2 Chunk Metadata Schema (Pinecone)

```json
{
  "id": "string",
  "source_id": "string",
  "jurisdiction_id": "string",
  "jurisdiction_type": "string",
  "source_type": "string",
  "citation": "string",
  "citation_normalized": "string",
  "title": "string",
  "chapter": "string",
  "section": "string",
  "text": "string",
  "text_preview": "string",
  "activity_tags": ["string"],
  "effective_date": "date",
  "source_url": "string",
  "last_updated": "datetime",
  "content_hash": "string"
}
```

---

## 7. Research Tasks (Pre-Build)

Before building, complete these research tasks:

### 7.1 MVP API Testing (Do First)
- [ ] Test eCFR API endpoints — **only federal API needed for MVP**

### 7.2 P1 API Testing (Defer)
- [ ] ~~Test Federal Register API endpoints~~ — P1
- [ ] ~~Test Regulations.gov API (get key)~~ — P1
- [ ] ~~Test Congress.gov API (get key)~~ — P1
- [ ] ~~Test LegiScan API (get key)~~ — P1

### 7.3 MVP Scraping Feasibility (Do First)
- [ ] Test scraping Texas Statutes (capitol.texas.gov) — static HTML, should work from CF Workers directly
- [ ] Test scraping Texas Admin Code (SOS site vs Cornell LII)
- [ ] Test scraping Municode (Houston) — requires Browserless for JS rendering
- [ ] Test scraping American Legal (Dallas)
- [ ] Test scraping Harris County municipal code
- [ ] Check robots.txt for all targets

### 7.4 Data Structure Analysis
- [ ] Document Texas Statute HTML structure
- [ ] Document TAC HTML structure
- [ ] Document Municode HTML structure
- [ ] Document American Legal HTML structure
- [ ] Identify citation patterns for each source

### 7.5 Volume Estimates
- [ ] Count pages/sections in Texas Statutes
- [ ] Count pages/sections in Texas Admin Code
- [ ] Count pages/sections per city (sample 3)
- [ ] Estimate total chunks for Texas pilot
- [ ] Estimate Pinecone storage requirements

### 7.6 MVP Setup (Do First)
- [ ] Create Convex project, define schema
- [ ] Create Cloudflare account, set up R2 bucket
- [ ] Create Pinecone index (3072 dims, cosine)
- [ ] Set up Browserless.io account

### 7.7 P1 Setup (Defer)
- [ ] ~~Register for LegiScan API key~~ — P1
- [ ] ~~Register for Regulations.gov API key~~ — P1
- [ ] ~~Register for Congress.gov API key~~ — P1

---

## 8. Known Challenges & Mitigations

| Challenge | Mitigation |
|-----------|------------|
| Municode requires JavaScript | Use Browserless.io via Cloudflare Workers |
| TAC site uses ASP.NET ViewState | Use Cornell LII as alternative, or handle ViewState |
| Some counties only publish PDFs | PDF extraction pipeline with Azure Doc Intelligence |
| Rate limiting on scraping | Respect delays, consider data partnerships |
| Data freshness varies | Track last_updated in Convex sources table, prioritize high-change sources |
| Citation format varies | Build citation normalizer |
| No unified schema across sources | Manual mapping per source type |

---

## 9. External Services Needed

### MVP Services (Required)

| Service | Purpose | Estimated Cost |
|---------|---------|----------------|
| Browserless.io | Playwright rendering for Municode etc. | $50-100/mo |
| Mapbox | Geocoding (called from Convex actions) | Free tier (100K/mo) |
| OpenAI | Embeddings (called from CF Workers) | ~$0.13/1M tokens |
| Anthropic | LLM (called from Convex actions) | ~$3/1M input tokens |
| Pinecone | Vector DB | $0-70/mo |
| Convex | Application backend | $0-25/mo |
| Cloudflare | Workers, R2, Queues | ~$50/mo |

### P1 Services (Deferred)

| Service | Purpose | When Needed |
|---------|---------|-------------|
| Azure Document Intelligence | PDF extraction | Only if county sources require PDF parsing |
| LegiScan | Bill tracking API | P1 change alerts feature |

---

## 10. Quick Reference: What to Build for MVP

```
MVP Data Pipeline Checklist:

┌─────────────────────────────────────────────────┐
│  ✅ MVP SOURCES (4)                             │
├─────────────────────────────────────────────────┤
│  1. eCFR API (federal regulations)              │
│  2. Texas Statutes scraper (state law)          │
│  3. Texas Admin Code scraper (state regs)       │
│  4. Local ordinances scrapers:                  │
│     - Municode (most cities)                    │
│     - American Legal (Dallas, Fort Worth)       │
│     - County sites                              │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  ⏳ P1 SOURCES (Defer)                          │
├─────────────────────────────────────────────────┤
│  - Federal Register (rule change alerts)        │
│  - Regulations.gov (redundant)                  │
│  - Congress.gov (federal bill tracking)         │
│  - GovInfo (redundant with eCFR)                │
│  - LegiScan (TX bill tracking)                  │
│  - Texas Register (TX rule change alerts)       │
└─────────────────────────────────────────────────┘
```

---

*Document version: 0.3*
*Last updated: January 31, 2026*
*Change log: Added MVP vs P1 prioritization; clarified data source overlap; deferred change tracking sources to P1*
