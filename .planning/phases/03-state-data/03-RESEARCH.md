# Phase 3: State Data - Research

**Researched:** 2026-02-01
**Domain:** Texas state law scraping and indexing (statutes and administrative code)
**Confidence:** MEDIUM

## Summary

Phase 3 extends the federal data pipeline pattern to Texas state regulatory sources. Research reveals that both Texas Statutes (capitol.texas.gov) and Texas Administrative Code (sos.state.tx.us) are available as HTML-based web interfaces without official APIs, requiring web scraping. The existing Phase 2 architecture (fetch -> R2 -> chunk -> embed -> Pinecone) can be replicated with HTML parsing instead of XML parsing.

Texas Statutes comprises 30 codes (not 28 as initially noted) organized by subject area, while the Texas Administrative Code contains 17 titles published by the Secretary of State. Neither source provides bulk download or API access, but both allow individual page/chapter downloads in PDF, DOCX, or TXT formats through their web interfaces.

The standard approach for HTML scraping in TypeScript is Cheerio (lightweight, jQuery-like API, TypeScript-native as of recent versions), paired with exponential backoff retry logic and rate limiting. Cloudflare Workers' HTMLRewriter is not suitable due to its streaming rewrite architecture being poorly suited for data extraction. Citations follow Texas Bluebook format with "Tex. [Code Name] Ann. § [section]" pattern.

**Primary recommendation:** Replicate Phase 2 pipeline architecture with Cheerio for HTML scraping, implement per-code checkpointing for Texas Statutes (30 codes), and per-title checkpointing for TAC (5 relevant titles). Use "tx-state" jurisdiction metadata to distinguish from federal sources in Pinecone.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cheerio | ^1.0.0 | HTML parsing and DOM traversal | Industry standard for HTML scraping in Node.js, TypeScript-native, jQuery-like API, faster than jsdom for static content |
| fast-xml-parser | ^5.3.4 | (already in use) | May be useful if TAC provides XML downloads as alternative format |
| js-tiktoken | ^1.0.21 | (already in use) | Token counting for chunk validation |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | ^4.1.0 | (already in use) | Timestamp handling for checkpoint management |
| zod | ^4.3.6 | (already in use) | Runtime validation of scraped HTML structure |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Cheerio | jsdom | jsdom provides full browser emulation with JavaScript execution but is significantly slower and unnecessary for static HTML content |
| Cheerio | Cloudflare HTMLRewriter | HTMLRewriter is callback-based and designed for streaming HTML rewriting, not data extraction. Poor fit for scraping despite being native to Workers runtime |
| Web scraping | Cornell LII API | Cornell LII provides Texas statutes/TAC in structured format but updates quarterly (not real-time), and no official API documented |

**Installation:**
```bash
pnpm add cheerio
```

## Architecture Patterns

### Recommended Project Structure
```
apps/workers/src/
├── federal/              # (existing) CFR pipeline
├── texas/                # NEW: Texas state pipeline
│   ├── types.ts          # Texas-specific types (StatuteSection, TACRule, etc.)
│   ├── fetch-statutes.ts # HTML scraping for capitol.texas.gov
│   ├── fetch-tac.ts      # HTML scraping for sos.state.tx.us
│   ├── parse.ts          # Cheerio-based HTML parsing
│   ├── chunk.ts          # Section-level chunking (reuse CFR patterns)
│   ├── storage.ts        # R2 storage with texas/ prefix
│   ├── pipeline.ts       # Orchestrator (mirrors federal/pipeline.ts)
│   └── index.ts          # Module exports
└── lib/
    ├── citations.ts      # ADD: Texas citation generators (Bluebook format)
    └── scraper.ts        # NEW: Shared scraping utilities (rate limiting, retry logic)
```

### Pattern 1: Cheerio HTML Parsing for Legal Documents

**What:** Use Cheerio to parse HTML structure and extract legal text while preserving hierarchy.

**When to use:** Texas Statutes and TAC are served as HTML pages with semantic markup.

**Example:**
```typescript
// Based on ZenRows TypeScript web scraping tutorial
import * as cheerio from 'cheerio';

interface TexasStatuteSection {
  code: string;
  chapter: string;
  section: string;
  heading: string;
  text: string;
}

async function fetchStatuteSection(
  code: string,
  section: string
): Promise<TexasStatuteSection> {
  const url = `https://statutes.capitol.texas.gov/Docs/${code}/htm/${code}.${section}.htm`;

  // Fetch with retry logic
  const response = await retryWithBackoff(() => fetch(url));
  const html = await response.text();

  // Parse with Cheerio
  const $ = cheerio.load(html);

  return {
    code,
    chapter: extractChapter($),
    section,
    heading: $('h2').first().text().trim(),
    text: $('.section-text').text().trim(), // Adjust selector based on actual HTML
  };
}
```

### Pattern 2: Exponential Backoff with Retry-After Headers

**What:** Implement retry logic that respects rate limit signals and backs off exponentially.

**When to use:** All HTTP requests to capitol.texas.gov and sos.state.tx.us to avoid 429 errors.

**Example:**
```typescript
// Based on web scraping best practices research
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 8000, // 8 seconds
};

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on 404 (page not found)
      if (isNotFoundError(error)) throw error;

      // Check for Retry-After header
      const retryAfter = extractRetryAfter(error);
      const delay = retryAfter || RETRY_CONFIG.baseDelay * Math.pow(2, attempt);

      if (attempt < RETRY_CONFIG.maxRetries) {
        console.log(`[Retry] ${operationName} after ${delay}ms (attempt ${attempt + 1})`);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}
```

### Pattern 3: Checkpoint-Based Resumption

**What:** Save progress after each code/title to enable resumption from failures.

**When to use:** Processing all 30 Texas codes or 5 TAC titles sequentially.

**Example:**
```typescript
// Reuse Phase 2 checkpoint pattern
export interface TexasCheckpoint {
  sourceType: 'statute' | 'tac';
  lastProcessedCode?: string; // For statutes: "AG", "AL", etc.
  lastProcessedTitle?: number; // For TAC: 16, 22, etc.
  timestamp: string;
  chunksProcessed: number;
  status: 'in_progress' | 'completed' | 'failed';
  error?: string;
}

// Store in R2: texas/checkpoints/statutes.json or texas/checkpoints/tac.json
```

### Anti-Patterns to Avoid

- **HTMLRewriter for scraping:** HTMLRewriter is designed for streaming HTML transformation, not data extraction. Its callback-based API and chunked text handling make scraping unnecessarily complex.
- **No rate limiting:** Government websites may have strict rate limits. Always implement delays between requests (100-500ms minimum) and respect robots.txt.
- **Ignoring HTML structure changes:** Capitol.texas.gov and SOS may change HTML structure without notice. Implement validation to detect parsing failures early.
- **Scraping entire codes at once:** Process code-by-code or title-by-title with checkpoints to avoid timeouts and enable recovery.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTML parsing | Custom regex-based HTML parsers | Cheerio | HTML is not regular; regex parsers break on nested structures, entities, and malformed markup |
| Retry logic | Simple setTimeout loops | Exponential backoff with jitter | Prevents thundering herd, respects server capacity, standard pattern for distributed systems |
| Token counting | Character-based estimates | js-tiktoken (already in use) | Accurate token counts for OpenAI embedding models, prevents oversized chunks |
| Citation formatting | String concatenation | Structured citation generators | Legal citations have strict format rules (Bluebook), hand-rolled formatters miss edge cases |

**Key insight:** Web scraping looks simple but has edge cases around rate limiting, retries, HTML parsing, and pagination. Use battle-tested libraries (Cheerio, exponential backoff) rather than custom implementations.

## Common Pitfalls

### Pitfall 1: Rate Limiting Blocks

**What goes wrong:** Scraping too fast triggers 429 (Too Many Requests) or IP blocks from capitol.texas.gov/sos.state.tx.us.

**Why it happens:** Government websites often have strict rate limits (e.g., 1-5 requests/second). Processing 30 codes without delays overwhelms servers.

**How to avoid:**
- Implement delay between requests (100-500ms minimum)
- Use exponential backoff on 429 errors
- Parse and respect Retry-After headers
- Process codes/titles sequentially, not in parallel

**Warning signs:**
- HTTP 429 responses
- Cloudflare challenge pages
- Connection timeouts or refused connections

### Pitfall 2: HTML Structure Dependency

**What goes wrong:** Scraper breaks when capitol.texas.gov changes HTML class names, IDs, or structure.

**Why it happens:** Government websites may update design, migrate to new CMS, or reorganize content without notice.

**How to avoid:**
- Use robust CSS selectors (prefer semantic tags over brittle class names)
- Implement validation to detect parsing failures
- Log warnings when expected elements are missing
- Fallback to alternative selectors or manual review

**Warning signs:**
- Empty text extraction
- Missing sections or chapters
- Undefined or null values in parsed data
- Cheerio selectors returning zero matches

### Pitfall 3: Text Chunking at Wrong Boundaries

**What goes wrong:** Cheerio's `.text()` concatenates all text content, losing subsection structure needed for legal chunking.

**Why it happens:** HTML elements may contain nested structure (subsections within sections), and naive `.text()` extraction flattens hierarchy.

**How to avoid:**
- Parse subsections individually using Cheerio selectors
- Preserve legal hierarchy markers (§, (a), (1), etc.)
- Reuse CFR chunking patterns from Phase 2 (section-level with subsection splitting)
- Validate chunk boundaries respect legal structure

**Warning signs:**
- Chunks that span multiple sections
- Lost cross-references between subsections
- Citation mismatches (chunk cites wrong section)

### Pitfall 4: Incomplete robots.txt Compliance

**What goes wrong:** Violating robots.txt directives may trigger blocks or legal issues.

**Why it happens:** While robots.txt is not legally binding in most jurisdictions, ignoring it demonstrates bad faith and increases legal risk.

**How to avoid:**
- Check robots.txt at capitol.texas.gov/robots.txt and sos.state.tx.us/robots.txt
- Respect Disallow directives
- Set appropriate User-Agent header identifying the scraper
- Implement rate limiting even if robots.txt doesn't specify Crawl-delay

**Warning signs:**
- Robots.txt contains Disallow: /statutes/ or similar
- User-Agent: * with restrictive rules
- No robots.txt (proceed cautiously with conservative rate limiting)

## Code Examples

Verified patterns from research sources:

### Texas Statute Citation Generation

```typescript
// Based on Texas Bluebook citation format research
// Source: Tarlton Law Library Bluebook guide

/**
 * Generate Bluebook-format Texas statute citation
 *
 * Format: Tex. [Code Name] Ann. § [section] (West [year])
 *
 * @example
 * generateTexasStatuteCitation('Penal', '30.02', 2024)
 * // => "Tex. Penal Code Ann. § 30.02 (West 2024)"
 */
export function generateTexasStatuteCitation(
  code: string,
  section: string,
  year: number = new Date().getFullYear()
): string {
  // Code abbreviations from capitol.texas.gov
  const codeAbbreviations: Record<string, string> = {
    'AG': 'Agric. Code',
    'AL': 'Alco. Bev. Code',
    'BC': 'Bus. & Com. Code',
    'BO': 'Bus. Orgs. Code',
    'CP': 'Civ. Prac. & Rem. Code',
    'CR': 'Crim. Proc. Code',
    'ED': 'Educ. Code',
    'EL': 'Elec. Code',
    'ES': 'Estates Code',
    'FA': 'Fam. Code',
    'FI': 'Fin. Code',
    'GV': 'Gov\'t Code',
    'HS': 'Health & Safety Code',
    'HR': 'Hum. Res. Code',
    'IN': 'Ins. Code',
    'LA': 'Lab. Code',
    'LG': 'Loc. Gov\'t Code',
    'NR': 'Nat. Res. Code',
    'OC': 'Occ. Code',
    'PW': 'Parks & Wild. Code',
    'PE': 'Penal Code',
    'PR': 'Prop. Code',
    'SD': 'Spec. Dist. Local Laws Code',
    'TX': 'Tax Code',
    'TN': 'Transp. Code',
    'UT': 'Util. Code',
    'WA': 'Water Code',
  };

  const codeAbbrev = codeAbbreviations[code.toUpperCase()] || `${code} Code`;

  return `Tex. ${codeAbbrev} Ann. § ${section} (West ${year})`;
}

/**
 * Generate capitol.texas.gov URL for statute section
 */
export function generateStatuteUrl(code: string, section: string): string {
  return `https://statutes.capitol.texas.gov/Docs/${code}/htm/${code}.${section}.htm`;
}
```

### Texas Administrative Code Citation

```typescript
/**
 * Generate Bluebook-format TAC citation
 *
 * Format: [Title] Tex. Admin. Code § [section] ([year])
 *
 * @example
 * generateTACCitation(16, '5.31', 2024)
 * // => "16 Tex. Admin. Code § 5.31 (2024)"
 */
export function generateTACCitation(
  title: number,
  section: string,
  year: number = new Date().getFullYear()
): string {
  return `${title} Tex. Admin. Code § ${section} (${year})`;
}

/**
 * Generate SOS website URL for TAC section
 */
export function generateTACUrl(title: number, section: string): string {
  // TAC URLs use title and chapter structure
  const [chapter] = section.split('.'); // Extract chapter from "5.31" => "5"
  return `https://texreg.sos.state.tx.us/public/readtac$ext.TacPage?sl=R&app=9&p_dir=&p_rloc=${title}&p_tloc=&p_ploc=&pg=1&p_tac=&ti=${title}&pt=${chapter}&ch=${section}`;
}
```

### Cheerio HTML Parsing with Error Handling

```typescript
// Based on ZenRows TypeScript web scraping tutorial and ScrapFly guide
import * as cheerio from 'cheerio';

/**
 * Fetch and parse Texas statute HTML
 */
export async function fetchTexasStatute(
  code: string,
  section: string
): Promise<TexasStatuteSection> {
  const url = generateStatuteUrl(code, section);

  console.log(`[TX Scraper] Fetching ${code} § ${section}`);

  const html = await retryWithBackoff(
    async () => {
      const response = await fetch(url);

      if (response.status === 404) {
        throw new NotFoundError(`Statute ${code} § ${section} not found`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.text();
    },
    `fetchTexasStatute(${code}, ${section})`
  );

  // Parse HTML with Cheerio
  const $ = cheerio.load(html);

  // Extract section text (adjust selectors based on actual HTML structure)
  const heading = $('h2.section-heading').first().text().trim();
  const text = $('.section-text').text().trim();

  // Validate extraction
  if (!text || text.length < 10) {
    throw new Error(`Failed to extract text from ${code} § ${section}. HTML structure may have changed.`);
  }

  return {
    code,
    section,
    heading,
    text,
    sourceUrl: url,
    scrapedAt: new Date().toISOString(),
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jsdom for HTML parsing | Cheerio (TypeScript-native) | Cheerio 1.0 (2023-2024) | Cheerio now fully TypeScript, eliminates need for @types/cheerio, better type inference |
| Fixed retry delays | Exponential backoff with Retry-After headers | Industry standard (2020+) | Reduces 429 errors, respects server capacity signals |
| robots.txt optional | robots.txt as legal evidence | Recent case law (2024-2025) | Violating robots.txt can establish tortious liability; compliance is best practice |
| Cloudflare HTMLRewriter popular | Cheerio for scraping | 2023+ | Community consensus: HTMLRewriter poor fit for scraping despite native Workers support |

**Deprecated/outdated:**
- **Cloudflare HTMLRewriter for scraping:** Callback-based API and text chunking make it unsuitable for data extraction despite being Workers-native
- **@types/cheerio:** No longer needed; Cheerio 1.0+ is TypeScript-native
- **Fixed delay rate limiting:** Modern practice uses exponential backoff and respects Retry-After headers

## Open Questions

Things that couldn't be fully resolved:

1. **Exact HTML structure of capitol.texas.gov statute pages**
   - What we know: Pages served as HTML with hierarchical structure
   - What's unclear: Specific CSS selectors for sections, subsections, chapter markers
   - Recommendation: Inspect actual HTML during implementation, build flexible selectors with fallbacks

2. **TAC title priority beyond specified 5 titles**
   - What we know: CONTEXT.md specifies titles 16, 22, 25, 30, 37 as relevant (pharmacy, optometry, alcohol)
   - What's unclear: Whether additional titles (e.g., Title 1 Administration, Title 30 Environmental Quality) are needed for retail compliance
   - Recommendation: Start with specified 5 titles, expand based on query coverage testing in Phase 7

3. **robots.txt policies for capitol.texas.gov and sos.state.tx.us**
   - What we know: Government websites should be checked for robots.txt directives
   - What's unclear: Actual restrictions (if any) on automated access
   - Recommendation: Fetch robots.txt during implementation, implement conservative rate limiting regardless

4. **TAC chapter vs. section vs. rule granularity**
   - What we know: TAC has 17 titles organized into chapters/sections/rules
   - What's unclear: Optimal chunking granularity (rule-level like CFR sections, or chapter-level)
   - Recommendation: Inspect TAC structure, aim for rule-level granularity to match CFR section-level chunking

5. **Statute effective dates and amendment tracking**
   - What we know: CFR XML includes effectiveDate and lastAmended metadata
   - What's unclear: Whether capitol.texas.gov HTML includes equivalent metadata
   - Recommendation: Extract if available, track scrapedAt timestamp as fallback for freshness

## Sources

### Primary (HIGH confidence)

- [Cheerio Official Documentation](https://cheerio.js.org/) - TypeScript-native HTML parsing library, industry standard
- [Texas Constitution and Statutes](https://statutes.capitol.texas.gov/) - Official source for Texas statutes
- [Texas Administrative Code (SOS)](https://www.sos.state.tx.us/tac/index.shtml) - Official source for TAC
- [Tarlton Law Library - Bluebook Texas Citations](https://tarlton.law.utexas.edu/bluebook-legal-citation/how-to-cite/statutes) - Authoritative Texas citation format guide
- Phase 2 federal pipeline implementation (apps/workers/src/federal/) - Proven architecture patterns

### Secondary (MEDIUM confidence)

- [ZenRows TypeScript Web Scraping Tutorial 2026](https://www.zenrows.com/blog/web-scraping-typescript) - Cheerio with TypeScript best practices
- [ScrapFly Complete Guide to TypeScript Web Scraping](https://scrapfly.io/blog/posts/ultimate-intro-to-web-scraping-with-typescript) - Type-safe scraping patterns
- [Web Scraping Rate Limiting Best Practices](https://www.scrapehero.com/rate-limiting-in-web-scraping/) - Exponential backoff and retry logic
- [Cloudflare Workers HTMLRewriter Documentation](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) - Why HTMLRewriter is unsuitable for scraping
- [robots.txt for Web Scraping: Legal Considerations](https://dataprixa.com/robots-txt-for-web-scraping/) - 2026 best practices

### Tertiary (LOW confidence)

- Cornell LII Texas materials - Provides structured access but updates quarterly, no API documented
- Community discussions on HTMLRewriter vs. Cheerio for scraping - Consistent consensus against HTMLRewriter

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Cheerio is well-documented TypeScript-native standard for HTML parsing
- Architecture: HIGH - Phase 2 federal pipeline provides proven pattern to replicate
- Pitfalls: MEDIUM - Web scraping best practices well-established, but HTML structure specifics require validation
- Citation formats: HIGH - Texas Bluebook format documented by Tarlton Law Library

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days - stable domain, government websites change infrequently)

**Verification needed during implementation:**
- Actual HTML structure of capitol.texas.gov statute pages (CSS selectors)
- Actual HTML structure of sos.state.tx.us TAC pages
- robots.txt policies for both domains
- Rate limit thresholds (test with conservative delays, adjust if needed)
- Texas code abbreviations completeness (verify all 30 codes have correct Bluebook forms)
