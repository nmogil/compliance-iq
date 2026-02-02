# Phase 5: Municipal Data - Research

**Researched:** 2026-02-02
**Domain:** Municipal ordinance scraping via Firecrawl API with markdown parsing
**Confidence:** MEDIUM

## Summary

Phase 5 requires scraping ordinances from 20 Texas cities hosted on two primary platforms: Municode (17 cities) and American Legal Publishing (3 cities). User decision: Use Firecrawl.dev for all JavaScript-rendered content, outputting markdown that simplifies downstream parsing.

Key technical challenges:
1. **Platform abstraction**: Firecrawl handles JS rendering for both Municode SPA and American Legal, eliminating need for separate adapters
2. **Markdown parsing**: Convert Firecrawl markdown output to structured ordinance objects with section/subsection hierarchy
3. **Error resilience**: Skip-and-log pattern for failed cities, matching county pipeline's graceful degradation
4. **Rate management**: Balance Firecrawl's built-in handling with conservative delays (Firecrawl Standard plan: 500 req/min for /scrape)

Research validates feasibility: Firecrawl SDK supports TypeScript, markdown output is parseable with `marked` library, and skip-and-log pattern is established in existing codebase (counties/fetch.ts).

**Primary recommendation:** Use Firecrawl Node SDK (@mendable/firecrawl-js) with `marked` for markdown parsing. Mirror county pipeline architecture (types → scraper → storage → chunking → pipeline → endpoints) for consistency.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @mendable/firecrawl-js | ^4.3.x | JavaScript rendering & scraping | Official Firecrawl Node SDK, TypeScript support, handles anti-bot protection |
| marked | ^15.x | Markdown parsing | Most popular markdown parser (12M+ weekly downloads), fast, extensible |
| cheerio | ^1.2.0 | HTML cleanup (if needed) | Already in project (county adapters), TypeScript-native |
| openai | ^6.17.0 | Embeddings via text-embedding-3-large | Already in project (federal/state/county) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @pinecone-database/pinecone | ^6.1.4 | Vector indexing | Already in project - reuse for municipal vectors |
| tiktoken | Via openai SDK | Token counting | Chunk validation (1500 token max) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Firecrawl | Browserless.io + Puppeteer | More control but requires managing browser infrastructure, proxy rotation, anti-bot handling |
| marked | remark/unified | More features but 40-459,000x slower for simple parsing; overkill for section extraction |
| Firecrawl | Playwright self-hosted | Lower API costs but higher infrastructure complexity, manual proxy/captcha handling |

**Installation:**
```bash
pnpm add @mendable/firecrawl-js marked
```

## Architecture Patterns

### Recommended Project Structure
```
apps/workers/src/municipal/
├── types.ts              # MunicipalOrdinance, MunicipalChunk, MunicipalCity interfaces
├── cities.ts             # 20 Texas cities registry with platform metadata
├── scraper.ts            # Firecrawl scraper with markdown-to-ordinance conversion
├── storage.ts            # R2 storage for municipal ordinances (municipal/{cityId}/)
├── chunk.ts              # Chunking with 1500 token limit + 15% overlap
├── fetch.ts              # Orchestrates scraping with skip-and-log error handling
├── pipeline.ts           # End-to-end: fetch → store → chunk → embed → index
└── index.ts              # Exports for HTTP endpoints
```

### Pattern 1: Firecrawl API Integration
**What:** Use Firecrawl's scrape endpoint to render JavaScript-heavy municipal sites
**When to use:** All 20 cities (both Municode and American Legal)
**Example:**
```typescript
// Source: Firecrawl Node SDK docs (docs.firecrawl.dev/sdks/node)
import Firecrawl from '@mendable/firecrawl-js';

const app = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

const result = await app.scrape({
  url: 'https://library.municode.com/tx/houston/codes/code_of_ordinances',
  formats: ['markdown'],
  onlyMainContent: true,
  waitFor: 2000, // Wait for JS to render
});

// result.markdown contains the page content
```

### Pattern 2: Markdown-to-Ordinance Parsing
**What:** Parse Firecrawl markdown output into structured ordinance sections
**When to use:** After successful Firecrawl scrape
**Example:**
```typescript
// Source: marked documentation (marked.js.org)
import { marked } from 'marked';

// Custom renderer to extract sections
const sections: MunicipalOrdinance[] = [];
let currentSection: Partial<MunicipalOrdinance> | null = null;

const renderer = {
  heading(text: string, level: number) {
    // Level 1-2: Chapter headings
    // Level 3: Section headings (e.g., "Section 1.02 - Definitions")
    if (level === 3 && text.match(/Section\s+([\d.-]+)/i)) {
      if (currentSection) sections.push(currentSection as MunicipalOrdinance);
      currentSection = {
        section: RegExp.$1,
        heading: text,
        text: '',
        // ... other fields
      };
    }
  },
  paragraph(text: string) {
    if (currentSection) {
      currentSection.text += text + '\n\n';
    }
  }
};

marked.use({ renderer });
marked.parse(markdownContent);
```

### Pattern 3: Skip-and-Log Error Handling
**What:** Continue processing remaining cities when individual scrapes fail
**When to use:** Batch processing of all 20 cities
**Example:**
```typescript
// Source: Existing pattern in counties/fetch.ts
export interface MunicipalBatchResult {
  successful: string[];
  failed: Array<{ city: string; error: string }>;
  skipped: string[];
}

async function fetchAllCities(): Promise<MunicipalBatchResult> {
  const result: MunicipalBatchResult = { successful: [], failed: [], skipped: [] };

  for (const city of ENABLED_CITIES) {
    try {
      await fetchCity(city);
      result.successful.push(city.name);
    } catch (error) {
      console.error(`[Municipal] Failed to fetch ${city.name}:`, error);
      result.failed.push({
        city: city.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Continue with next city - don't fail entire batch
    }
  }

  return result;
}
```

### Pattern 4: City Registry with Platform Metadata
**What:** Central registry of 20 Texas cities with Firecrawl configuration
**When to use:** All municipal operations
**Example:**
```typescript
// Source: Adapted from counties/sources.ts pattern
export interface MunicipalCityConfig {
  name: string;
  cityId: string; // URL-safe identifier (e.g., "houston")
  platform: 'municode' | 'amlegal';
  baseUrl: string;
  enabled: boolean;
  skipReason?: string;
  // Firecrawl-specific config
  waitFor?: number; // ms to wait for JS rendering
  includeSelectors?: string[]; // Focus on code content
}

export const TEXAS_CITIES: MunicipalCityConfig[] = [
  {
    name: 'Houston',
    cityId: 'houston',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/houston/codes/code_of_ordinances',
    enabled: true,
    waitFor: 2000, // Municode SPA needs rendering time
  },
  {
    name: 'Dallas',
    cityId: 'dallas',
    platform: 'amlegal',
    baseUrl: 'https://codelibrary.amlegal.com/codes/dallas/latest/dallas_tx/0-0-0-1',
    enabled: true,
    waitFor: 1000, // Server-rendered, less wait needed
  },
  // ... 18 more cities
];
```

### Anti-Patterns to Avoid
- **Custom browser automation**: Don't use Puppeteer/Playwright directly - Firecrawl handles JS rendering, proxies, and anti-bot measures
- **Platform-specific adapters**: User decision is unified Firecrawl approach for all platforms (no MunicodeAdapter/AmlegalAdapter like counties)
- **Fixed delays without Firecrawl context**: Firecrawl has built-in rate limiting - don't add excessive delays that slow processing unnecessarily
- **Failing entire batch on single city error**: Must implement skip-and-log pattern per user requirements

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JavaScript rendering | Custom Puppeteer setup | Firecrawl API | Handles proxies, browser fingerprinting, anti-bot detection, captcha solving automatically |
| Markdown AST traversal | Regex-based parsing | `marked` with custom renderer | Handles edge cases (nested lists, code blocks, escaping) that regex misses |
| Rate limiting logic | Custom delay tracking | Firecrawl's built-in handling + simple delays | Firecrawl manages per-account limits; simple 1-2s delays sufficient |
| Token counting | Manual word/char estimation | `tiktoken` (via OpenAI SDK) | Accurate token counts matching embedding model's tokenization |
| Citation formatting | String concatenation | Bluebook utility functions | Already exists in lib/citations.ts - extend for municipal format |

**Key insight:** Municipal code scraping is complex (dynamic content, anti-bot protection, varying site structures). Firecrawl abstracts this complexity, allowing focus on data processing rather than browser automation.

## Common Pitfalls

### Pitfall 1: Ignoring Firecrawl Credit Costs
**What goes wrong:** Scraping 20 cities × thousands of sections = high API costs if not cached properly
**Why it happens:** Each Firecrawl /scrape call costs 1 credit; naively re-scraping on every pipeline run wastes credits
**How to avoid:**
- Store raw markdown from Firecrawl in R2 (municipal/{cityId}/raw/)
- Only re-scrape if data is stale (check lastScrapedAt timestamp)
- Use Firecrawl's `maxAge` cache parameter for recently scraped pages
**Warning signs:** High Firecrawl bill, repeated scrapes of same URLs

### Pitfall 2: Markdown Structure Assumptions
**What goes wrong:** Assuming Firecrawl markdown has consistent heading structure across all cities/platforms
**Why it happens:** Different platforms (Municode vs. American Legal) may produce different markdown heading levels
**How to avoid:**
- Use flexible heading detection (check levels 1-4 for "Section")
- Validate structure after parsing (log warnings if expected patterns not found)
- Fall back to full-page extraction if section parsing fails
**Warning signs:** Missing sections, empty ordinance arrays, parse errors

### Pitfall 3: Rate Limit Misunderstanding
**What goes wrong:** Hitting Firecrawl rate limits despite conservative delays
**Why it happens:** Rate limits are per-minute, not per-request; 500 req/min (Standard plan) = ~8 req/sec
**How to avoid:**
- Track requests per minute, not just inter-request delay
- Use Firecrawl's batch scraping for multiple URLs
- Monitor response headers for rate limit info
**Warning signs:** 429 errors from Firecrawl, queued requests

### Pitfall 4: Incomplete Error Context
**What goes wrong:** City marked as "failed" without enough context to debug later
**Why it happens:** Generic error logging doesn't capture Firecrawl-specific failures (timeout vs. 404 vs. parse error)
**How to avoid:**
- Log Firecrawl response metadata (status_code, cache_state, credits_used)
- Store failed URLs in checkpoint with error category
- Include markdown snippet in error logs for parse failures
**Warning signs:** Can't reproduce failures, unclear why city was skipped

### Pitfall 5: Chunk Boundary Loss
**What goes wrong:** Splitting ordinances at arbitrary token limits loses legal structure (mid-subsection splits)
**Why it happens:** Reusing county chunking logic without adapting for markdown input format
**How to avoid:**
- Parse subsections from markdown before chunking (look for lettered lists: "(a)", "(b)")
- Use subsection boundaries as primary split points
- Only use paragraph splitting as fallback when no subsections exist
**Warning signs:** Incomplete subsections in chunks, broken cross-references

## Code Examples

Verified patterns from official sources:

### Firecrawl Scraping with Error Handling
```typescript
// Source: Firecrawl Node SDK docs (docs.firecrawl.dev/sdks/node)
import Firecrawl from '@mendable/firecrawl-js';

interface FirecrawlScrapeResult {
  markdown: string;
  metadata: {
    title: string;
    url: string;
    statusCode: number;
    credits_used: number;
  };
}

async function scrapeMunicipalCode(
  city: MunicipalCityConfig
): Promise<FirecrawlScrapeResult> {
  const app = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

  try {
    const result = await app.scrape({
      url: city.baseUrl,
      formats: ['markdown'],
      onlyMainContent: true, // Filter out nav/footer
      waitFor: city.waitFor ?? 2000, // Platform-specific wait time
      timeout: 30000, // 30s max
    });

    return {
      markdown: result.markdown,
      metadata: {
        title: result.metadata.title,
        url: result.metadata.sourceURL,
        statusCode: result.metadata.statusCode,
        credits_used: 1, // Standard scrape = 1 credit
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('429')) {
      throw new RateLimitError('Firecrawl rate limit exceeded');
    }
    throw error;
  }
}
```

### Markdown Parsing with Section Detection
```typescript
// Source: marked documentation (marked.js.org) + custom logic
import { marked } from 'marked';

interface ParsedSection {
  chapter: string;
  section: string;
  heading: string;
  text: string;
  subsections: Array<{ id: string; text: string }>;
}

function parseMarkdownToOrdinances(
  markdown: string,
  city: MunicipalCityConfig
): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentChapter = '';
  let currentSection: ParsedSection | null = null;

  // Custom renderer to track structure
  const renderer = {
    heading(text: string, level: number) {
      // Chapter heading (level 1-2)
      const chapterMatch = text.match(/Chapter\s+([\d]+)/i);
      if (chapterMatch && level <= 2) {
        currentChapter = chapterMatch[1];
        return;
      }

      // Section heading (level 3)
      const sectionMatch = text.match(/(?:Sec\.|Section)\s*([\d.-]+)[:\s]+(.*)/i);
      if (sectionMatch && level === 3) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          chapter: currentChapter,
          section: sectionMatch[1],
          heading: sectionMatch[2],
          text: '',
          subsections: [],
        };
      }
    },

    list(body: string) {
      // Detect subsections in lettered lists
      if (!currentSection) return;

      const subsectionMatches = body.matchAll(/\(([a-z])\)\s*([^(]+)/gi);
      for (const match of subsectionMatches) {
        currentSection.subsections.push({
          id: `(${match[1]})`,
          text: match[2].trim(),
        });
      }
    },

    paragraph(text: string) {
      if (currentSection) {
        currentSection.text += text + '\n\n';
      }
    },
  };

  marked.use({ renderer });
  marked.parse(markdown);

  // Push final section
  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}
```

### Batch Processing with Skip-and-Log
```typescript
// Source: Pattern from counties/fetch.ts, adapted for Firecrawl
async function processMunicipalBatch(): Promise<MunicipalBatchResult> {
  const result: MunicipalBatchResult = {
    successful: [],
    failed: [],
    skipped: [],
    totalCreditsUsed: 0,
  };

  const cities = getEnabledCities();

  for (const city of cities) {
    try {
      console.log(`[Municipal] Processing ${city.name}...`);

      const scrapeResult = await scrapeMunicipalCode(city);
      result.totalCreditsUsed += scrapeResult.metadata.credits_used;

      const ordinances = parseMarkdownToOrdinances(scrapeResult.markdown, city);

      // Store in R2
      await storeMunicipalOrdinances(city, ordinances);

      result.successful.push(city.name);

      // Conservative delay between cities (user discretion)
      await sleep(2000); // 2s between cities

    } catch (error) {
      console.error(`[Municipal] Failed to process ${city.name}:`, error);
      result.failed.push({
        city: city.name,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
      // Continue with next city - don't fail entire batch
    }
  }

  return result;
}
```

### R2 Storage Pattern
```typescript
// Source: Pattern from counties/storage.ts, adapted for municipal
async function storeMunicipalOrdinances(
  city: MunicipalCityConfig,
  ordinances: ParsedSection[]
): Promise<void> {
  const bucket = env.R2_BUCKET;

  for (const ordinance of ordinances) {
    const key = `municipal/${city.cityId}/chapter-${ordinance.chapter}/${ordinance.section}.json`;

    await bucket.put(
      key,
      JSON.stringify(ordinance, null, 2),
      {
        httpMetadata: {
          contentType: 'application/json',
        },
        customMetadata: {
          city: city.name,
          platform: city.platform,
          scrapedAt: new Date().toISOString(),
        },
      }
    );
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Self-hosted Puppeteer | Managed APIs (Firecrawl, Browserless) | ~2023 | Reduces infrastructure burden, better anti-bot handling |
| Platform-specific adapters | Unified scraping API | User decision for this phase | Simpler codebase, but less platform-specific optimization |
| Regex HTML parsing | Markdown + structured parsers | ~2024 | Cleaner parsing logic, easier to debug |
| Fixed rate limits | Dynamic rate limiting with monitoring | ~2025 | Better resource utilization, fewer 429 errors |

**Deprecated/outdated:**
- **Direct Puppeteer scraping**: Modern municipal sites use sophisticated bot detection (Cloudflare, Akamai) that requires constant updates to bypass; managed APIs abstract this
- **Cheerio-only parsing for SPAs**: Municode is a React SPA - Cheerio sees only initial HTML skeleton; need JS rendering (Firecrawl) or API discovery
- **Synchronous batch processing**: Large batches (20 cities × 1000s sections) should use async queues with checkpointing for fault tolerance

## Open Questions

Things that couldn't be fully resolved:

1. **Firecrawl markdown consistency across platforms**
   - What we know: Firecrawl converts HTML to markdown, but structure varies by source HTML
   - What's unclear: Whether Municode SPA vs. American Legal server-rendered produce consistently parseable markdown
   - Recommendation: Build flexible parser that tries multiple heading patterns; log structure samples during testing

2. **Optimal rate limiting values**
   - What we know: Firecrawl Standard plan allows 500 req/min; user suggested 1-2s baseline delay
   - What's unclear: Whether to batch multiple pages per city in single Firecrawl call vs. scrape TOC then individual sections
   - Recommendation: Start with 1 req per city (TOC page), parse navigation, then batch subsequent section requests; monitor credit usage

3. **Subsection detection reliability**
   - What we know: Legal subsections use patterns like "(a)", "(1)", "(i)" - but markdown conversion may alter formatting
   - What's unclear: Whether Firecrawl preserves list structure enough to detect subsections reliably
   - Recommendation: Test with sample cities (Houston, Dallas, Austin) first; implement fallback to paragraph splitting if subsection detection fails

4. **Cache vs. freshness tradeoff**
   - What we know: Firecrawl supports `maxAge` caching; municipal codes update infrequently (quarterly/annually)
   - What's unclear: Appropriate cache duration for municipal ordinances (weeks? months?)
   - Recommendation: Set maxAge=30 days for initial implementation; add lastScrapedAt tracking in Convex for manual re-scraping

5. **Firecrawl /crawl endpoint viability**
   - What we know: Firecrawl has /crawl endpoint that discovers and scrapes multiple pages automatically
   - What's unclear: Whether /crawl works well with Municode's SPA navigation (may not find client-side routes)
   - Recommendation: Use /scrape for MVP (explicit URL list); evaluate /crawl in Phase 6 for automated discovery

## Sources

### Primary (HIGH confidence)
- Firecrawl Node SDK documentation - docs.firecrawl.dev/sdks/node
  - Installation, setup, API methods, TypeScript support verified
- Firecrawl Advanced Scraping Guide - docs.firecrawl.dev/advanced-scraping-guide
  - Output formats, rate limits, configuration options verified
- Firecrawl Rate Limits documentation - docs.firecrawl.dev/rate-limits
  - Standard plan: 500 req/min for /scrape, 50 concurrent browsers verified
- marked documentation - marked.js.org
  - Custom renderer pattern, heading detection verified
- Existing codebase patterns
  - counties/adapters/base.ts - rate limiting, error handling patterns
  - counties/storage.ts - R2 storage patterns
  - counties/chunk.ts - chunking with 1500 token limit and 15% overlap
  - texas/chunk.ts - subsection splitting patterns

### Secondary (MEDIUM confidence)
- Municipal code platform research (WebSearch verified with official sites)
  - Houston: library.municode.com/tx/houston - Municode platform confirmed
  - Dallas: codelibrary.amlegal.com/codes/dallas - American Legal confirmed
  - Austin: library.municode.com/tx/austin - Municode platform confirmed
  - Fort Worth: codelibrary.amlegal.com/codes/ftworth - American Legal confirmed
  - San Antonio: library.municode.com/tx/san_antonio - Municode platform confirmed
- Firecrawl pricing information - www.firecrawl.dev/pricing
  - Standard plan: $83/month for 100K pages (1 credit per page) verified via multiple sources
- Markdown parsing library comparison - npm-compare.com
  - marked vs. remark performance: marked 40-459,000x faster verified

### Tertiary (LOW confidence)
- GitHub municode-scraper projects - noclocks/municode-scraper, dkylewillis/municode-scraper-lib
  - Validate Municode structure insights but projects use Playwright, not Firecrawl
- Web scraping best practices articles - Various sources on exponential backoff, rate limiting
  - General patterns confirmed but not Firecrawl-specific

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Firecrawl and marked are well-documented with official TypeScript support
- Architecture: HIGH - Mirrors established county pipeline patterns from existing codebase
- Pitfalls: MEDIUM - Based on general scraping experience + Firecrawl docs, but not tested with municipal sites specifically
- Platform mapping: MEDIUM - WebSearch verified with official city sites, but haven't tested all 20 cities

**Research date:** 2026-02-02
**Valid until:** 2026-03-02 (30 days - Firecrawl API stable, municipal sites change slowly)

**Key risks:**
1. Firecrawl markdown output may vary more than expected between platforms → Flexible parser mitigates
2. API costs could be high for 20 cities × 1000s sections → R2 caching + selective re-scraping mitigates
3. Rate limits may be tighter than anticipated → Monitoring + adaptive delays mitigates
4. Subsection detection from markdown may fail → Fallback to paragraph splitting mitigates

**Next steps for planner:**
1. Break into 6 plans mirroring county phase: types/registry → scraper → storage → chunking → pipeline → endpoints
2. Prioritize Houston/Dallas/Austin for early testing (validate Firecrawl approach before scaling to all 20)
3. Build flexible markdown parser that handles structure variations
4. Implement comprehensive error logging for debugging failed cities
5. Add Firecrawl credit monitoring to avoid surprise API bills
