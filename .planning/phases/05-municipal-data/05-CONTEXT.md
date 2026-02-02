# Phase 5: Municipal Data - Context

**Gathered:** 2026-02-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Scrape and index municipal ordinances from 20 Texas cities using Municode and American Legal platforms. Target cities: Houston, San Antonio, Dallas, Austin, Fort Worth, El Paso, Arlington, Plano, Corpus Christi, Lubbock, Laredo, Irving, Garland, Frisco, McKinney, Amarillo, Grand Prairie, Brownsville, Killeen, Pasadena.

</domain>

<decisions>
## Implementation Decisions

### JS Rendering Strategy
- Use Firecrawl.dev for all JavaScript-rendered municipal sites
- Unified approach for both Municode and American Legal platforms
- Firecrawl handles dynamic content, anti-bot protection, and proxies automatically
- Output in markdown format for simplified parsing

### Rate Limiting
- Claude's discretion on rate limiting — balance Firecrawl's built-in handling with conservative delays based on site characteristics
- Consider 1-2 second delays for municipal sites as baseline

### Error Handling
- Skip and log on failure — mark city as "needs manual review" and continue with remaining cities
- Do not fail entire batch if individual city fails
- Log detailed error information for post-processing review

### Platform Handling
- Same Firecrawl approach for all platforms (Municode and American Legal)
- No separate adapters needed — Firecrawl abstracts platform differences
- Unified pipeline regardless of underlying site technology

### Claude's Discretion
- Specific rate limit values per platform
- Retry strategy before marking as failed
- City processing order and prioritization
- Caching strategy for Firecrawl responses
- Output parsing from Firecrawl markdown to structured chunks

</decisions>

<specifics>
## Specific Ideas

- Firecrawl.dev for JavaScript rendering — user explicitly requested this over Browserless.io or self-hosted Puppeteer
- Markdown output from Firecrawl simplifies downstream chunking
- "Skip and log" matches the graceful degradation pattern from county pipeline

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-municipal-data*
*Context gathered: 2026-02-02*
