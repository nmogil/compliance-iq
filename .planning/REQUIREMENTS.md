# Requirements: ComplianceIQ

**Defined:** 2026-01-31
**Core Value:** Lawyers can get cited regulatory answers in minutes instead of hours

## v1 Requirements

Requirements for Texas pilot. Each maps to roadmap phases.

### Data Pipeline

- [x] **DATA-01**: eCFR API integration returns federal regulation text with citations
- [x] **DATA-02**: Texas Statutes scraper extracts all 28 codes with section-level granularity
- [x] **DATA-03**: Texas Administrative Code scraper extracts relevant titles (16, 22, 25, 30, 37)
- [x] **DATA-04**: Municode scraper extracts ordinances from 15+ Texas cities
- [x] **DATA-05**: American Legal scraper extracts ordinances from Dallas, Fort Worth, Austin
- [x] **DATA-06**: County regulation scraper extracts from top 10 Texas counties
- [x] **DATA-07**: Chunking pipeline splits regulatory text into embeddable segments with metadata
- [x] **DATA-08**: Embedding pipeline generates vectors via OpenAI text-embedding-3-large
- [x] **DATA-09**: Pinecone index stores vectors with jurisdiction/activity/citation metadata
- [x] **DATA-10**: R2 storage persists raw scraped documents for audit/reprocessing

### Query Interface

- [x] **QUERY-01**: User can ask natural language compliance questions
- [x] **QUERY-02**: System resolves address to applicable jurisdictions (federal, state, county, municipal)
- [x] **QUERY-03**: RAG pipeline retrieves relevant regulatory chunks from Pinecone
- [x] **QUERY-04**: Claude generates response with inline citations to source law
- [ ] **QUERY-05**: Response streams in real-time as Claude generates
- [x] **QUERY-06**: Citations link to original source text (URLs or document references)
- [x] **QUERY-07**: Response identifies required permits/licenses with issuing agency

### Application

- [ ] **APP-01**: User can sign up and log in via Clerk authentication
- [ ] **APP-02**: User can create new conversations
- [ ] **APP-03**: User can view conversation history
- [ ] **APP-04**: User can continue previous conversations with context preserved
- [ ] **APP-05**: User can provide feedback (helpful/not helpful) on responses
- [ ] **APP-06**: System tracks message status (pending, processing, streaming, complete, error)

### Coverage

- [x] **COV-01**: Federal regulations covering Costco business activities (food, alcohol, pharmacy, fuel, employment)
- [x] **COV-02**: Texas state statutes relevant to retail operations
- [x] **COV-03**: Texas Administrative Code for licensing boards (pharmacy, optometry, alcohol)
- [x] **COV-04**: Top 10 Texas counties by Costco presence (Harris, Dallas, Tarrant, Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso)
- [x] **COV-05**: Top 20 Texas cities by Costco presence (Houston, San Antonio, Dallas, Austin, Fort Worth, El Paso, Arlington, Plano, Corpus Christi, Lubbock, Laredo, Irving, Garland, Frisco, McKinney, Amarillo, Grand Prairie, Brownsville, Killeen, Pasadena)

## v2 Requirements

Deferred to P1/P2. Tracked but not in current roadmap.

### Change Tracking (P1)

- **CHANGE-01**: System monitors LegiScan for Texas bills affecting retail compliance
- **CHANGE-02**: System monitors Federal Register for proposed/final rules
- **CHANGE-03**: User receives alerts when relevant regulations change
- **CHANGE-04**: System re-scrapes sources on schedule to detect updates

### External API (P2)

- **API-01**: REST API endpoint for programmatic compliance queries
- **API-02**: API key authentication for external consumers
- **API-03**: Rate limiting and usage tracking
- **API-04**: OpenAPI specification for Costco integration

### Dashboard (P2)

- **DASH-01**: User can view compliance status across jurisdictions
- **DASH-02**: User can see permit renewal timeline
- **DASH-03**: User can generate compliance checklists for new locations
- **DASH-04**: User can view agency contact information

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-state expansion | Texas pilot proves value first; data pipeline work compounds |
| Mobile app | Web-first; lawyers use desktop for research |
| OAuth/SSO | Email/password via Clerk sufficient for pilot |
| Real-time legal chat | This is research tooling, not live support |
| PDF report export | Can add later; streaming UI is primary interface |
| Compliance scoring | Subjective; lawyers interpret requirements themselves |
| Automated permit applications | Out of scope; this is research, not workflow |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 2 | Complete |
| DATA-02 | Phase 3 | Complete |
| DATA-03 | Phase 3 | Complete |
| DATA-04 | Phase 5 | Complete |
| DATA-05 | Phase 5 | Complete |
| DATA-06 | Phase 4 | Complete |
| DATA-07 | Phase 2, validated in Phase 6 | Complete |
| DATA-08 | Phase 2, validated in Phase 6 | Complete |
| DATA-09 | Phase 2, validated in Phase 6 | Complete |
| DATA-10 | Phase 2, validated in Phase 6 | Complete |
| QUERY-01 | Phase 7 | Complete |
| QUERY-02 | Phase 7 | Complete |
| QUERY-03 | Phase 7 | Complete |
| QUERY-04 | Phase 7 | Complete |
| QUERY-05 | Phase 9 | Pending |
| QUERY-06 | Phase 7 | Complete |
| QUERY-07 | Phase 7 | Complete |
| APP-01 | Phase 8 | Pending |
| APP-02 | Phase 8 | Pending |
| APP-03 | Phase 8 | Pending |
| APP-04 | Phase 8 | Pending |
| APP-05 | Phase 9 | Pending |
| APP-06 | Phase 8 | Pending |
| COV-01 | Phase 2 (validated) | Complete |
| COV-02 | Phase 3 (validated) | Complete |
| COV-03 | Phase 3 (validated) | Complete |
| COV-04 | Phase 4 (validated) | Complete |
| COV-05 | Phase 5 (validated) | Complete |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

**Notes:**
- DATA-07 through DATA-10 are first implemented in Phase 2 (Federal Data) and then validated across all data sources in Phase 6 (Data Processing)
- COV-01 through COV-05 are validation requirements that confirm data coverage during their respective data ingestion phases

---
*Requirements defined: 2026-01-31*
*Last updated: 2026-02-03 - Phase 7 complete (QUERY-01, QUERY-02, QUERY-03, QUERY-04, QUERY-06, QUERY-07)*
