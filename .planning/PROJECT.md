# ComplianceIQ

## What This Is

A regulatory compliance research platform that answers: "What laws, regulations, permits, and licenses do I need to [operate/sell X] at [specific address]?" Provides AI-powered reports with citations from actual legal text across federal, state, county, and municipal jurisdictions. Built for Costco's legal team as the first customer, targeting a Texas pilot with 40+ warehouse locations.

## Core Value

**Lawyers can get cited regulatory answers in minutes instead of hours.** Everything else (dashboard, change alerts, API) is secondary. The research experience with real citations must work first.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Natural language query interface for compliance questions
- [ ] Federal regulation coverage via eCFR API
- [ ] Texas state statutes coverage (scraped)
- [ ] Texas Administrative Code coverage (scraped)
- [ ] Top 10 Texas county ordinance coverage
- [ ] Top 20 Texas city municipal code coverage
- [ ] Address-to-jurisdiction resolution (geocoding)
- [ ] RAG pipeline returning relevant regulatory chunks
- [ ] Citation linking to source legal text
- [ ] Reports with structured permit/license information
- [ ] Real-time streaming responses
- [ ] User authentication (Clerk)
- [ ] Conversation history and context

### Out of Scope

- Multi-state expansion — Texas pilot proves value first
- Change tracking/alerts (LegiScan, Federal Register) — P1 feature, not MVP
- Compliance checklists — P2 feature
- External REST API for Costco integrations — P2 feature
- Mobile app — web-first
- OAuth/SSO — email/password via Clerk sufficient for pilot
- Real-time chat with legal advisors — this is research tooling, not chat support

## Context

**The problem:** A single Costco warehouse selling groceries, alcohol, pharmacy, prepared food, gas, hearing aids, and optical can need 50+ distinct permits from 15+ agencies across 4 jurisdictional layers. New store openings require months of manual research. Current process relies on legal teams, expensive consultants, and tribal knowledge.

**Codify AI precedent:** Costco already uses Codify AI for Canadian compliance and it works well. There's no US equivalent — internally called the "Holy Grail."

**The bet:** LLMs + RAG make parsing regulatory text at scale newly feasible. The moat is the data layer (scraping, structuring, indexing regulatory content across thousands of sources), not the AI.

**Costco business activities to support:**
- Food retail (produce, meat, seafood, frozen, bakery, deli, dairy)
- Food service (food court, sushi prep, rotisserie)
- Alcohol (beer, wine, spirits)
- Pharmacy (prescriptions, controlled substances, immunizations)
- Optical & hearing
- Fuel (gasoline, diesel, underground storage tanks)
- Tire service
- General operations (employment, signage, parking, fire safety, ADA)

## Constraints

- **Tech stack**: Convex (application), Cloudflare Workers (data pipeline), Pinecone (vectors), React (frontend), Claude (LLM), OpenAI (embeddings) — architecture decided
- **Codebase**: Monorepo with pnpm workspaces — structure decided
- **MVP geography**: Texas only — pilot state has 40+ Costco warehouses and complex regulatory environment
- **Data sources (MVP)**: eCFR API, Texas Statutes (scrape), Texas Admin Code (scrape), Municode/American Legal (scrape) — change tracking sources deferred to P1
- **Accuracy**: >90% correct on sample queries — this is legal research, citations must be real
- **First customer**: Costco legal team — design for their workflow (research questions, reports with citations)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Texas as pilot state | Large Costco presence (40+), complex regulatory environment, legislature meets every 2 years (simpler tracking) | — Pending |
| Convex + Cloudflare hybrid | Convex for real-time app layer (chat, auth, streaming), Cloudflare for batch data pipeline (scraping, embedding) | — Pending |
| eCFR only for federal MVP | Other federal sources (Federal Register, GovInfo) are redundant or for change tracking (P1) | — Pending |
| Pinecone for vectors | Managed, scales well, metadata filtering for jurisdiction/activity queries | — Pending |
| Monorepo with pnpm | Tight coupling between components requires shared types; single source of truth | — Pending |
| Scraping over data vendors | Data aggregation is the moat; building first-party scraping infrastructure | — Pending |

---
*Last updated: 2026-01-31 after initialization*
