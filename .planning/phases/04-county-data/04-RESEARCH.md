# Phase 4: County Data - Research

**Researched:** 2026-02-01
**Domain:** Texas county ordinance scraping and indexing (top 10 counties)
**Confidence:** MEDIUM

## Summary

Phase 4 extends the data pipeline to Texas county-level regulations. Research reveals significant differences from Phase 3 (state data): Texas counties have very limited ordinance-making authority compared to municipalities, operating primarily through commissioners court orders rather than comprehensive ordinance codes. Unlike state statutes with consistent HTML structure across all codes, each county has unique online presence and source availability.

The top 10 Texas counties by Costco presence (Harris, Dallas, Tarrant, Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso) show heterogeneous source availability. Harris County uses MunicipalCodeOnline.com, Dallas County uses eLaws, some counties have no codified ordinance databases, and many regulations exist only as individual commissioners court orders in meeting minutes rather than searchable ordinance codes.

Critical insight: Counties regulate different domains than state/federal law. County authority is restricted to subdivision regulations, road/drainage construction, sexually-oriented establishments, septic systems, flood plain development, and limited zoning (in unincorporated areas). Most retail compliance (food safety, alcohol, pharmacy) is state/federal jurisdiction, with counties enforcing state law through permits rather than creating independent ordinances.

**Primary recommendation:** Research each county individually before implementation to identify best source per county (codified ordinances vs court orders vs no online presence). Use same Phase 3 architecture (Cheerio scraping, R2 storage, chunking, Pinecone) but expect to skip counties without accessible online sources and document coverage gaps. Scraper design depends on source similarity findings—likely needs flexible per-county adapters rather than single unified scraper.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cheerio | ^1.2.0 | HTML parsing for county ordinance websites | Already in use from Phase 3, TypeScript-native, handles varied HTML structures across county platforms |
| zod | ^4.3.6 | Runtime validation of scraped ordinance structure | Already in use, critical for validating heterogeneous county sources |
| js-tiktoken | ^1.0.21 | Token counting for chunk validation | Already in use from Phase 2/3 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| date-fns | ^4.1.0 | Timestamp handling for court order dates | Already in use, needed for tracking court order adoption dates |
| fast-xml-parser | ^5.3.4 | XML parsing if counties provide structured formats | Already in use, may be useful if some counties export XML |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-county research | Bulk scraping all counties blind | Research-first approach avoids wasted effort on inaccessible sources |
| Cheerio + manual adapters | Playwright for JavaScript-heavy sites | Most county code platforms serve static HTML; Playwright adds complexity/cost for minimal benefit |
| Include all counties | Skip counties without online sources | CONTEXT.md explicitly permits skipping inaccessible counties to avoid manual outreach |

**Installation:**
```bash
# No new dependencies needed - Cheerio already installed in Phase 3
pnpm install # Verify existing dependencies
```

## Architecture Patterns

### Recommended Project Structure

```
apps/workers/src/
├── federal/              # (existing) CFR pipeline
├── texas/                # (existing) State pipeline
├── counties/             # NEW: County ordinance pipeline
│   ├── types.ts          # County-specific types (CountyOrdinance, CourtOrder, etc.)
│   ├── sources.ts        # County source registry (URL, platform type, enabled status)
│   ├── adapters/         # Platform-specific scrapers
│   │   ├── base.ts       # Abstract CountyAdapter interface
│   │   ├── municode.ts   # MunicipalCodeOnline.com adapter (Harris County)
│   │   ├── elaws.ts      # eLaws platform adapter (Dallas County)
│   │   ├── amlegal.ts    # American Legal Publishing adapter
│   │   └── court-orders.ts # Commissioner court order scraper (for counties without codes)
│   ├── fetch.ts          # County-specific fetch orchestrator
│   ├── parse.ts          # Ordinance text parsing
│   ├── chunk.ts          # County ordinance chunking
│   ├── storage.ts        # R2 storage with counties/ prefix
│   ├── pipeline.ts       # Orchestrator (mirrors texas/pipeline.ts)
│   └── index.ts          # Module exports
└── lib/
    ├── citations.ts      # ADD: County citation generators (Bluebook format)
    └── scraper.ts        # (existing) Shared scraping utilities
```

### Pattern 1: Adapter-Based Multi-Platform Scraping

**What:** Abstract adapter interface with platform-specific implementations for heterogeneous county sources.

**When to use:** When counties use different code publishing platforms (MunicipalCodeOnline, eLaws, American Legal, custom sites).

**Example:**
```typescript
// Based on research findings showing varied county platforms
export interface CountyAdapter {
  /** County identifier (e.g., "Harris", "Dallas") */
  county: string;

  /** Base URL for this county's ordinance source */
  baseUrl: string;

  /** Platform type (affects scraping strategy) */
  platform: 'municode-online' | 'elaws' | 'amlegal' | 'custom' | 'court-orders';

  /** Fetch all ordinances/court orders for this county */
  fetchOrdinances(): AsyncGenerator<CountyOrdinance, void, unknown>;

  /** Validate that source is accessible and hasn't changed structure */
  validateSource(): Promise<{ accessible: boolean; error?: string }>;
}

// Harris County adapter (MunicipalCodeOnline.com)
export class HarrisCountyAdapter implements CountyAdapter {
  county = 'Harris';
  baseUrl = 'https://harriscounty.municipalcodeonline.com/';
  platform = 'municode-online' as const;

  async *fetchOrdinances(): AsyncGenerator<CountyOrdinance, void, unknown> {
    // Scrape MunicipalCodeOnline structure
    const $ = await this.loadPage(this.baseUrl);

    // Extract ordinance chapters/sections
    const chapters = $('.ordinance-chapter'); // Adjust based on actual HTML

    for (const chapter of chapters) {
      // Yield individual ordinances
      yield await this.parseOrdinance(chapter);
    }
  }

  async validateSource(): Promise<{ accessible: boolean; error?: string }> {
    try {
      const response = await fetch(this.baseUrl);
      if (!response.ok) {
        return { accessible: false, error: `HTTP ${response.status}` };
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Validate expected structure exists
      if ($('.ordinance-chapter').length === 0) {
        return {
          accessible: false,
          error: 'HTML structure changed - ordinance chapters not found'
        };
      }

      return { accessible: true };
    } catch (error) {
      return {
        accessible: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async loadPage(url: string): Promise<cheerio.CheerioAPI> {
    const html = await retryWithBackoff(() => fetch(url).then(r => r.text()));
    return cheerio.load(html);
  }

  private async parseOrdinance(element: cheerio.Element): Promise<CountyOrdinance> {
    // Implementation details
    throw new Error('Not implemented');
  }
}
```

### Pattern 2: County Source Registry with Enable/Disable Flags

**What:** Centralized registry tracking which counties have accessible sources and should be processed.

**When to use:** Managing heterogeneous county availability across the 10 target counties.

**Example:**
```typescript
// Based on CONTEXT.md guidance to skip inaccessible counties
export interface CountySourceConfig {
  /** County name */
  name: string;

  /** FIPS code for county (for geocoding integration) */
  fipsCode: string;

  /** Source platform (if online source exists) */
  platform?: 'municode-online' | 'elaws' | 'amlegal' | 'custom' | 'court-orders';

  /** Base URL (if online source exists) */
  baseUrl?: string;

  /** Whether this county has accessible online ordinances */
  hasOnlineSource: boolean;

  /** Whether to process this county (false = skip and document gap) */
  enabled: boolean;

  /** Reason if not enabled */
  skipReason?: string;

  /** Regulatory categories this county covers */
  categories: string[];
}

export const TARGET_COUNTIES: CountySourceConfig[] = [
  {
    name: 'Harris',
    fipsCode: '48201',
    platform: 'municode-online',
    baseUrl: 'https://harriscounty.municipalcodeonline.com/',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'infrastructure', 'parks'],
  },
  {
    name: 'Dallas',
    fipsCode: '48113',
    platform: 'elaws',
    baseUrl: 'http://dallascounty-tx.elaws.us/code/coor',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building'],
  },
  {
    name: 'Tarrant',
    fipsCode: '48439',
    hasOnlineSource: false, // No codified ordinances found
    enabled: false,
    skipReason: 'No online ordinance database; regulations in court orders only',
    categories: [],
  },
  {
    name: 'Bexar',
    fipsCode: '48029',
    hasOnlineSource: false, // Research needed to confirm
    enabled: false,
    skipReason: 'Online source not confirmed during research',
    categories: [],
  },
  // ... remaining counties
];

export function getEnabledCounties(): CountySourceConfig[] {
  return TARGET_COUNTIES.filter(c => c.enabled);
}

export function getSkippedCounties(): CountySourceConfig[] {
  return TARGET_COUNTIES.filter(c => !c.enabled);
}
```

### Pattern 3: Commissioner Court Order Scraping (Alternative Source)

**What:** For counties without codified ordinances, scrape commissioners court meeting minutes/orders.

**When to use:** When county has no MunicipalCode/eLaws/AmLegal database but publishes court orders online.

**Example:**
```typescript
// Based on research showing counties operate via court orders
export interface CourtOrder {
  county: string;
  orderNumber: string;
  adoptionDate: string;
  title: string;
  text: string;
  sourceUrl: string;
  scrapedAt: string;
}

export class CourtOrderScraper {
  /**
   * Scrape court orders from county commissioners court agendas/minutes
   *
   * Example: Tarrant County publishes agendas at
   * https://www.tarrantcountytx.gov/en/commissioners-court/commissioners-court-agenda-videos.html
   */
  async *fetchCourtOrders(county: string, baseUrl: string): AsyncGenerator<CourtOrder> {
    // Fetch meeting agendas/minutes index page
    const $ = await this.loadPage(baseUrl);

    // Extract links to individual meetings (adjust selectors per county)
    const meetingLinks = $('.meeting-link').toArray().map(el => $(el).attr('href'));

    for (const link of meetingLinks) {
      const meeting$ = await this.loadPage(link);

      // Extract court orders from meeting minutes
      const orders = this.parseCourtOrders(meeting$);

      for (const order of orders) {
        yield order;
      }

      // Rate limiting between meetings
      await sleep(500);
    }
  }

  private parseCourtOrders($: cheerio.CheerioAPI): CourtOrder[] {
    // Implementation varies by county HTML structure
    // May need PDF parsing if orders published as PDFs
    throw new Error('Not implemented');
  }
}
```

### Anti-Patterns to Avoid

- **Assuming uniform structure across counties:** Each county platform has unique HTML structure, selectors, and navigation. Validate per-county rather than assuming similarity.
- **Scraping counties without online sources:** CONTEXT.md explicitly permits skipping counties with no online ordinance library. Don't waste effort on manual outreach or PDF uploads.
- **Treating county ordinances like municipal codes:** Counties have limited ordinance authority; many "regulations" are actually state law enforcement (permits) rather than county-created law.
- **Ignoring commissioners court orders:** Some counties codify ordinances; others only publish court orders in meeting minutes. Both are valid regulatory sources.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Platform detection | Manual URL inspection | Adapter registry with platform types | Centralized source-of-truth for which counties use which platforms |
| Multi-platform scraping | Monolithic scraper with if/else | Adapter pattern with platform-specific implementations | Separates concerns, easier to maintain per-platform logic |
| Court order PDF parsing | Custom PDF text extraction | Existing PDF libraries (pdf-parse, pdfjs-dist) | PDFs have complex structure (columns, formatting); use battle-tested parsers |
| County FIPS code lookup | Hardcoded county-to-FIPS mapping | USDA FIPS code data or geocoding API | FIPS codes are standardized; don't maintain custom mapping |

**Key insight:** County ordinances are fundamentally heterogeneous. Unlike federal (single XML API) or state (consistent HTML structure), counties require flexible architecture that accepts source variability rather than fighting it.

## Common Pitfalls

### Pitfall 1: Assuming Counties Regulate Retail Operations

**What goes wrong:** Scraping county ordinances expecting food safety, alcohol, pharmacy regulations but finding only subdivision/zoning rules.

**Why it happens:** Texas counties have limited ordinance authority. Most retail compliance (food safety, alcohol, pharmacy) is state/federal jurisdiction. Counties enforce state law through permits but don't create independent ordinances.

**How to avoid:**
- Focus scraping on county-specific domains: subdivision regulations, building codes (unincorporated areas), road/drainage, zoning (unincorporated), septic systems, flood plains
- Don't expect comprehensive retail ordinances like municipal codes
- Document that county layer primarily covers real estate/development rather than operational compliance

**Warning signs:**
- County ordinance code has only 3-5 chapters (vs 20+ for municipal codes)
- Most chapters relate to subdivision/platting/building
- Food/alcohol/pharmacy regulations missing or just reference state law

### Pitfall 2: Court Orders vs. Codified Ordinances Confusion

**What goes wrong:** Expecting all counties to have searchable ordinance codes like Harris/Dallas, but finding only commissioners court meeting minutes.

**Why it happens:** Some counties codify ordinances into organized codes (Harris County), others publish individual court orders in chronological meeting minutes (Tarrant County). Both are valid but require different scraping strategies.

**How to avoid:**
- Research each county individually to identify format (codified vs court orders)
- For codified ordinances: scrape MunicipalCode/eLaws/AmLegal platforms
- For court orders only: scrape commissioners court agendas/minutes, extract adopted orders
- Document which counties have codified ordinances vs court orders only

**Warning signs:**
- County website has "Commissioners Court" section but no "Code of Ordinances"
- Court agendas/minutes are primary source of regulatory information
- No third-party code publishing platform (MunicipalCode/eLaws/AmLegal)

### Pitfall 3: Over-Scraping Counties Without Retail Relevance

**What goes wrong:** Scraping comprehensive county ordinance codes including irrelevant chapters (e.g., election procedures, personnel policies, purchasing rules).

**Why it happens:** County ordinance codes often include administrative policies, personnel rules, and procedural regulations that don't affect Costco retail operations.

**Recommendation (Claude's Discretion per CONTEXT.md):**
- Filter to retail-relevant chapters: subdivision regulations, building codes, health/safety (septic, flood), zoning (if unincorporated Costco locations exist)
- Skip administrative chapters: personnel, budgets, elections, purchasing, vehicle operations
- Document filtering criteria in coverage report

**Warning signs:**
- County code includes "Personnel Rules", "Budget Procedures", "Election Administration"
- Ordinances regulate county employee conduct, not private business operations
- Chapters reference only county government, not public/businesses

### Pitfall 4: Violating robots.txt on Code Publishing Platforms

**What goes wrong:** American Legal Publishing's robots.txt disallows many crawlers (ClaudeBot, GPTBot, AI training bots) with 5-second crawl delay for others.

**Why it happens:** Code publishing platforms protect against aggressive scraping and AI training data collection.

**How to avoid:**
- Check robots.txt for each platform: codelibrary.amlegal.com, library.municode.com, municipalcodeonline.com, elaws platforms
- Implement User-Agent that complies with robots.txt rules
- Respect crawl delays (5 seconds for American Legal)
- American Legal explicitly blocks AI training: "Content-Signal: search=yes,ai-train=no"
- Consider reaching out to platforms for data access agreements if scraping at scale

**Warning signs:**
- HTTP 429 (Too Many Requests) responses
- robots.txt contains "Disallow: /" for your User-Agent
- Platform serves Cloudflare challenge pages

### Pitfall 5: Assuming All 10 Counties Have Online Sources

**What goes wrong:** Planning scraper architecture for 10 counties but discovering only 3-5 have accessible online ordinance databases.

**Why it happens:** Not all counties publish ordinances online. Some require in-person visits to county clerk, others have ordinances only in paper format or unpublished court orders.

**How to avoid:**
- Pre-implementation research phase to validate online source availability (per CONTEXT.md)
- Document source availability in CountySourceConfig registry
- Set `enabled: false` for counties without online sources
- Create coverage report listing skipped counties and reasons
- Don't attempt manual outreach or PDF uploads (per CONTEXT.md)

**Warning signs:**
- County website has no "Code of Ordinances" or "County Code" section
- Contact information for county clerk but no online database
- Third-party platforms (MunicipalCode/AmLegal) don't list the county

## Code Examples

Verified patterns from research sources:

### County Ordinance Citation Generation

```typescript
// Based on Bluebook Rule 12.9.2: Municipal ordinances cited analogously to statutes
// Source: Georgetown Law Bluebook Guide, Tarlton Law Library

/**
 * Generate Bluebook-format county ordinance citation
 *
 * Format: [County Name], Tex., [Code Name] § [section] ([year])
 *
 * @example
 * generateCountyCitation('Harris', 'County Code', '1.02', 2026)
 * // => "Harris County, Tex., County Code § 1.02 (2026)"
 */
export function generateCountyCitation(
  county: string,
  codeName: string,
  section: string,
  year: number = new Date().getFullYear()
): string {
  return `${county} County, Tex., ${codeName} § ${section} (${year})`;
}

/**
 * Generate citation for commissioners court order
 *
 * Format: [County Name] Commissioners Court Order No. [number] ([date])
 *
 * @example
 * generateCourtOrderCitation('Tarrant', '2026-045', new Date('2026-03-15'))
 * // => "Tarrant County Commissioners Court Order No. 2026-045 (Mar. 15, 2026)"
 */
export function generateCourtOrderCitation(
  county: string,
  orderNumber: string,
  adoptionDate: Date
): string {
  const dateStr = format(adoptionDate, 'MMM. d, yyyy'); // "Mar. 15, 2026"
  return `${county} County Commissioners Court Order No. ${orderNumber} (${dateStr})`;
}

/**
 * Generate URL for county ordinance source
 */
export function generateCountyOrdinanceUrl(config: CountySourceConfig, section?: string): string {
  if (!config.baseUrl) {
    throw new Error(`County ${config.name} has no online source`);
  }

  // Platform-specific URL construction
  switch (config.platform) {
    case 'municode-online':
      return section
        ? `${config.baseUrl}book?type=ordinances#name=${section}`
        : config.baseUrl;

    case 'elaws':
      return section
        ? `${config.baseUrl}#${section}`
        : config.baseUrl;

    case 'amlegal':
      return section
        ? `${config.baseUrl}codes/overview?nodeId=${section}`
        : config.baseUrl;

    default:
      return config.baseUrl;
  }
}
```

### Platform-Specific Scraping Examples

```typescript
// Based on research showing varied platforms across counties

/**
 * MunicipalCodeOnline.com scraper (Harris County)
 *
 * Source: https://harriscounty.municipalcodeonline.com/
 */
export async function scrapeMunicipalCodeOnline(
  baseUrl: string
): Promise<CountyOrdinance[]> {
  const ordinances: CountyOrdinance[] = [];

  // Fetch main page
  const response = await retryWithBackoff(() => fetch(baseUrl));
  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract available books/codes
  // Note: Actual selectors need validation against live site
  const books = $('.available-books a.book-link').toArray();

  for (const book of books) {
    const bookUrl = $(book).attr('href');
    if (!bookUrl) continue;

    // Fetch individual book
    await sleep(500); // Rate limiting
    const book$ = await loadCheerioPage(`${baseUrl}${bookUrl}`);

    // Extract chapters/sections (adjust selectors based on actual HTML)
    const sections = book$('.ordinance-section').toArray();

    for (const section of sections) {
      ordinances.push({
        county: 'Harris',
        section: book$(section).find('.section-number').text().trim(),
        heading: book$(section).find('.section-heading').text().trim(),
        text: book$(section).find('.section-content').text().trim(),
        sourceUrl: `${baseUrl}${bookUrl}`,
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  return ordinances;
}

/**
 * eLaws platform scraper (Dallas County)
 *
 * Source: http://dallascounty-tx.elaws.us/code/coor
 */
export async function scrapeELaws(baseUrl: string): Promise<CountyOrdinance[]> {
  const ordinances: CountyOrdinance[] = [];

  const $ = await loadCheerioPage(baseUrl);

  // eLaws typically uses iframes and JavaScript navigation
  // May require Playwright for full scraping, or direct URL construction

  // Extract table of contents links (adjust selectors)
  const tocLinks = $('.toc-item a').toArray();

  for (const link of tocLinks) {
    const sectionUrl = $(link).attr('href');
    if (!sectionUrl) continue;

    await sleep(500);
    const section$ = await loadCheerioPage(sectionUrl);

    ordinances.push({
      county: 'Dallas',
      section: section$('.section-number').text().trim(),
      heading: section$('h1').text().trim(),
      text: section$('.section-text').text().trim(),
      sourceUrl: sectionUrl,
      scrapedAt: new Date().toISOString(),
    });
  }

  return ordinances;
}

/**
 * Helper: Load Cheerio page with retry logic
 */
async function loadCheerioPage(url: string): Promise<cheerio.CheerioAPI> {
  const html = await retryWithBackoff(
    async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.text();
    },
    `loadCheerioPage(${url})`
  );

  return cheerio.load(html);
}
```

### County Source Validation

```typescript
/**
 * Validate all county sources before scraping
 *
 * Checks accessibility and HTML structure for each enabled county
 */
export async function validateCountySources(): Promise<{
  valid: CountySourceConfig[];
  invalid: Array<{ config: CountySourceConfig; error: string }>;
}> {
  const valid: CountySourceConfig[] = [];
  const invalid: Array<{ config: CountySourceConfig; error: string }> = [];

  for (const county of getEnabledCounties()) {
    if (!county.baseUrl) {
      invalid.push({ config: county, error: 'No base URL configured' });
      continue;
    }

    try {
      const response = await fetch(county.baseUrl);

      if (!response.ok) {
        invalid.push({
          config: county,
          error: `HTTP ${response.status}: ${response.statusText}`
        });
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Platform-specific validation
      const isValid = validatePlatformStructure($, county.platform!);

      if (isValid) {
        valid.push(county);
      } else {
        invalid.push({
          config: county,
          error: 'HTML structure changed - expected elements not found'
        });
      }
    } catch (error) {
      invalid.push({
        config: county,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Rate limiting between county checks
    await sleep(1000);
  }

  return { valid, invalid };
}

function validatePlatformStructure(
  $: cheerio.CheerioAPI,
  platform: string
): boolean {
  switch (platform) {
    case 'municode-online':
      return $('.available-books').length > 0 || $('.ordinance-section').length > 0;

    case 'elaws':
      return $('.toc-item').length > 0 || $('.section-text').length > 0;

    case 'amlegal':
      return $('.code-section').length > 0; // Adjust based on actual structure

    default:
      return false;
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic municipal scraper | Adapter pattern for heterogeneous platforms | 2024-2025 | Handles variation in MunicipalCode, eLaws, AmLegal, custom county sites |
| Assume all counties online | Pre-research source availability | 2025+ | Prevents wasted effort on inaccessible sources |
| robots.txt optional | Explicit AI training restrictions | 2025-2026 | American Legal blocks "ai-train", requires compliance |
| Scrape everything | Filter to regulatory relevance | 2025+ | Focuses on retail-relevant ordinances, skips administrative chapters |

**Deprecated/outdated:**
- **Uniform county scraping:** Counties are too heterogeneous; requires platform-specific adapters
- **Assuming county retail regulations:** Most retail compliance is state/federal; counties focus on subdivision/zoning
- **Ignoring commissioners court orders:** Some counties publish orders not codes; both are valid sources

## Open Questions

Things that couldn't be fully resolved:

1. **Exact platform for each of 10 counties**
   - What we know: Harris uses MunicipalCodeOnline, Dallas uses eLaws, some counties may have no online source
   - What's unclear: Platform for Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso (research needed)
   - Recommendation: Implementation task 1 should be individual county research to populate CountySourceConfig

2. **HTML structure for county ordinance platforms**
   - What we know: MunicipalCodeOnline, eLaws, and American Legal have different HTML structures
   - What's unclear: Specific CSS selectors for ordinance sections, chapters, TOC navigation
   - Recommendation: Inspect actual HTML during adapter implementation, build flexible selectors

3. **Court order vs codified ordinance ratio**
   - What we know: Some counties codify ordinances (Harris), others use court orders (Tarrant)
   - What's unclear: How many of 10 target counties have codified ordinances vs court orders only
   - Recommendation: Document per county during research; may need court order scraper for 3-5 counties

4. **County ordinance chunking granularity**
   - What we know: State statutes chunk at section level (Phase 3 pattern)
   - What's unclear: Whether county ordinances follow same section-level structure or need different chunking
   - Recommendation: Start with section-level chunking like Phase 3, adjust if county sections are too large/small

5. **Retail relevance filtering criteria**
   - What we know: Counties regulate subdivision, zoning, building (unincorporated), not food/alcohol/pharmacy operations
   - What's unclear: Which specific ordinance chapters/topics to include vs skip
   - Recommendation (Claude's Discretion): Include subdivision regulations, building codes, health/safety (septic/flood), zoning; skip administrative/personnel/budget chapters

6. **Data access agreements with code publishers**
   - What we know: American Legal blocks AI crawlers, has 5-second crawl delay
   - What's unclear: Whether scraping violates Terms of Service, whether data agreements available
   - Recommendation: Review ToS during implementation; consider contacting MunicipalCode/AmLegal/eLaws for bulk access if scraping poses legal risk

## Sources

### Primary (HIGH confidence)

- [Texas State Law Library - Municipal Ordinances Guide](https://guides.sll.texas.gov/texas-law/local-ordinances) - Authoritative guide to accessing county/municipal ordinances
- [Harris County Municipal Code Online](https://harriscounty.municipalcodeonline.com/) - Live county ordinance source
- [Dallas County Code (eLaws)](http://dallascounty-tx.elaws.us/code/coor) - Live county ordinance source
- [Tarlton Law Library - Bluebook Citation Guide](https://tarlton.law.utexas.edu/bluebook-legal-citation/how-to-cite) - Texas legal citation formats
- [Texas State Handbook - County Commissioners Court](https://www.tshaonline.org/handbook/entries/county-commissioners-court) - County government structure and authority
- Phase 3 State Data research and implementation - Proven Cheerio scraping architecture

### Secondary (MEDIUM confidence)

- [Georgetown Law - Bluebook Municipal Ordinances](https://guides.ll.georgetown.edu/bluebook/citing-statutes) - Municipal/county ordinance citation format (Bluebook Rule 12.9.2)
- [American Legal Publishing robots.txt](https://codelibrary.amlegal.com/robots.txt) - Platform scraping restrictions
- [ZenRows TypeScript Web Scraping 2026](https://www.zenrows.com/blog/web-scraping-typescript) - Cheerio with TypeScript patterns
- [ScrapFly Web Scraping Rate Limits 2026](https://www.scrapehero.com/rate-limiting-in-web-scraping/) - Rate limiting best practices
- [GitHub noclocks/municode-scraper](https://github.com/noclocks/municode-scraper) - Example Municode scraping project (Python/Selenium)

### Tertiary (LOW confidence)

- Web search results about county ordinance availability (varying quality)
- Community discussions on scraping government code platforms

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Cheerio already in use from Phase 3, proven for HTML scraping
- Architecture: MEDIUM - Adapter pattern is sound, but specific county platforms need validation
- Pitfalls: MEDIUM - County authority limitations well-documented, but platform-specific issues need testing
- Citation formats: HIGH - Bluebook Rule 12.9.2 clearly documents municipal/county ordinance citation

**Research date:** 2026-02-01
**Valid until:** 2026-03-01 (30 days - county websites change infrequently, but source availability may shift)

**Verification needed during implementation:**
1. Platform identification for each of 10 counties (Harris ✓, Dallas ✓, remaining 8 TBD)
2. Actual HTML structure for MunicipalCodeOnline, eLaws, American Legal (CSS selectors)
3. robots.txt compliance verification for each platform
4. Source availability validation (which counties have accessible online ordinances)
5. County ordinance chapter/section structure for chunking decisions
6. Terms of Service review for code publishing platforms (legal risk assessment)
7. Filtering criteria definition for retail-relevant vs administrative ordinances

**Key unknowns requiring Task 1 (County Source Research):**
- Which of the 10 counties have accessible online ordinance databases
- Which platform each county uses (MunicipalCodeOnline, eLaws, AmLegal, custom, court orders)
- HTML structure specifics for each platform
- Whether any counties require Playwright for JavaScript-rendered content
- Expected volume (number of ordinances per county) for pipeline planning
