---
phase: 05
plan: 02
subsystem: municipal-data
tags: [firecrawl, scraping, markdown, parsing, municipal]
dependency-graph:
  requires: [05-01, 05-03]
  provides:
    - Firecrawl scraper module with caching
    - Markdown parser for municipal ordinances
  affects: [05-04, 05-05, 05-06]
tech-stack:
  added:
    - "@mendable/firecrawl-js@4.12.0"
    - "marked@17.0.1"
  patterns:
    - Firecrawl scrape with markdown output
    - Skip-and-log batch processing
    - R2 markdown caching for cost optimization
    - marked lexer for section extraction
key-files:
  created:
    - apps/workers/src/municipal/scraper.ts
    - apps/workers/src/municipal/parser.ts
  modified:
    - apps/workers/package.json
    - apps/workers/src/municipal/index.ts
decisions:
  - id: firecrawl-scrape-method
    choice: "Use Firecrawl v2 scrape() method"
    rationale: "SDK exports Firecrawl class with scrape() not scrapeUrl()"
  - id: marked-token-type
    choice: "Import Token type separately from Tokens namespace"
    rationale: "marked v17 exports Token as top-level type, not Tokens.Token"
  - id: subsection-regex
    choice: "Two-pass subsection detection"
    rationale: "Try inline patterns first, then line-start patterns for flexibility"
metrics:
  duration: "~5 minutes"
  completed: 2026-02-02
---

# Phase 5 Plan 2: Firecrawl Scraper and Markdown Parser Summary

**One-liner:** Firecrawl SDK scrapes JS-rendered municipal sites to markdown; marked lexer parses sections with flexible heading detection.

## What Was Built

### Scraper Module (`scraper.ts`)

Firecrawl-based scraper for JavaScript-rendered municipal code sites (Municode SPA, American Legal server-rendered).

**Exports:**
- `scrapeMunicipalCode(apiKey, city)` - Core Firecrawl scrape
- `scrapeCity(env, city, options)` - Scrape with R2 caching
- `scrapeAllCities(env, options)` - Batch processing with skip-and-log
- `sleep(ms)` - Rate limiting utility
- `FirecrawlError` - Error class with city/platform context
- `FirecrawlScrapeResult` - Scrape result interface

**Key Features:**
- Platform-specific waitFor: 2000ms for Municode, 1000ms for American Legal
- 30-day default cache expiration for markdown
- R2 markdown caching to minimize Firecrawl credit usage
- Skip-and-log batch processing (continues on individual failures)
- Detailed error logging with city metadata

### Parser Module (`parser.ts`)

Markdown-to-ordinance parser using marked lexer.

**Exports:**
- `parseMarkdownToOrdinances(markdown, city)` - Full parsing
- `extractSections(markdown)` - Quick section listing
- `validateOrdinances(ordinances, city)` - Validation with warnings
- `countSectionsInMarkdown(markdown)` - Quick count
- `extractChaptersFromMarkdown(markdown)` - Chapter listing
- `cleanMarkdownText(text)` - Whitespace normalization

**Key Features:**
- Chapter detection from level 1-2 headings
- Section detection from level 2-4 headings
- Flexible patterns: "Section 1-2", "Sec. 1.02", "1.03."
- Subsection extraction: (a), (b), (1), (2), (i), (ii)
- Validation with warnings for parsing issues

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 492ae01 | chore | Install Firecrawl and marked dependencies |
| 65873db | feat | Implement Firecrawl municipal scraper |
| 85a90c1 | feat | Implement markdown parser for municipal ordinances |

## Technical Decisions

### Firecrawl SDK Version
Used `@mendable/firecrawl-js@4.12.0` with v2 API. The default export is `Firecrawl` class with `scrape()` method (not `scrapeUrl()` from v1).

### Marked Token Types
marked v17 exports `Token` as a top-level type. Usage: `import { marked, type Token, type Tokens } from 'marked'`. Individual token types (Heading, List, etc.) are under `Tokens` namespace.

### Subsection Detection
Two-pass approach:
1. Inline regex: `\(([a-z]|\d+)\)\s+([^(]+?)(?=\([a-z\d]|\s*$)`
2. Line-start regex: `^\s*\(([a-z]|\d+)\)\s+(.+)$`

This handles both inline "(a) text (b) text" and multiline formats.

## Verification Results

| Check | Status |
|-------|--------|
| Dependencies installed | PASS |
| TypeScript compiles (municipal modules) | PASS |
| Scraper exports correct functions | PASS |
| Parser exports correct functions | PASS |
| Index.ts exports all modules | PASS |

**Note:** Pre-existing TypeScript errors in `texas/fetch-statutes.ts` and `texas/parse-statutes.ts` are not from this plan. Documented in STATE.md as known issues.

## Deviations from Plan

None - plan executed exactly as written.

## Dependencies for Next Plans

### 05-04 (Chunking Module)
- Uses `MunicipalOrdinance` from `parseMarkdownToOrdinances`
- Needs subsections array for section-level chunking

### 05-05 (Pipeline Orchestration)
- Uses `scrapeCity` for individual city processing
- Uses `parseMarkdownToOrdinances` after scraping
- Uses `validateOrdinances` for quality checks

### 05-06 (HTTP Endpoints)
- Uses `scrapeAllCities` for batch endpoint
- Returns `MunicipalBatchResult` with success/failure details

## Next Phase Readiness

**Ready for 05-04 (Chunking):**
- MunicipalOrdinance type available with chapter, section, text, subsections
- Validation function available for quality filtering

**Configuration needed before production:**
- FIRECRAWL_API_KEY must be set in Workers secrets
- Consider adjusting maxCacheAgeMs based on municipal code update frequency
