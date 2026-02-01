# Phase 02 Plan 02: eCFR API Integration Summary

**One-liner:** eCFR API fetcher with retry logic, XML parser for CFR title/part/section hierarchy, environment secrets configured

---

## Metadata

```yaml
phase: 02-federal-data
plan: 02
subsystem: data-pipeline
status: complete
completed: 2026-02-01
duration: 2.4 minutes

# Dependencies
requires:
  - 01-01  # Monorepo structure
  - 01-03  # Cloudflare Workers setup
  - 02-01  # Dependencies and types

provides:
  - eCFR API integration with retry logic
  - XML parser for CFR structure (titles, parts, sections)
  - Environment type definitions for secrets

affects:
  - 02-03  # R2 storage (will use fetched XML)
  - 02-04  # Chunking (will use parsed sections)
  - 02-05  # Embedding (will use chunked content)

# Technical tracking
tech-stack:
  added:
    - fast-xml-parser: "^5.3.4"
  patterns:
    - Exponential backoff retry logic for API calls
    - Recursive XML parsing for hierarchical CFR structure
    - Type-safe environment bindings for Cloudflare Workers

# File tracking
key-files:
  created:
    - apps/workers/src/federal/fetch.ts: eCFR API client with retry logic
  modified:
    - apps/workers/src/types.ts: Added OPENAI_API_KEY, PINECONE_API_KEY, CONVEX_URL
    - apps/workers/wrangler.jsonc: Documented secret configuration

# Decisions
decisions:
  - id: ecfr-retry-strategy
    choice: Exponential backoff with 3 retries (1s, 2s, 4s delays)
    rationale: Gracefully handles rate limits (429) and transient errors
    alternatives: []

  - id: xml-parsing-library
    choice: fast-xml-parser with ignoreAttributes=false
    rationale: Preserves XML attributes needed for effective dates, amendments
    alternatives: []

  - id: parser-architecture
    choice: Combined fetch and parse in single module
    rationale: Tight coupling between API responses and parsing logic
    alternatives: []
```

---

## What Was Built

### eCFR API Client
- **fetchCFRTitleList()**: Retrieves list of all CFR titles from eCFR API
- **fetchCFRTitle(titleNumber)**: Fetches full XML for a specific CFR title
- **fetchCFRPart(titleNumber, partNumber)**: Fetches XML for specific part within title

### Retry Logic
- Exponential backoff: 1s, 2s, 4s delays over 3 retry attempts
- Handles HTTP 429 (rate limit), 5xx (server errors) with retry
- Immediately fails on HTTP 404 (title not found) without retry
- Custom `ECFRFetchError` class for detailed error reporting

### XML Parser
- **parseCFRXML(xml)**: Parses raw eCFR XML into structured CFRTitle
- **extractParts(titleXML)**: Extracts all parts from title XML
- **extractSections(partXML)**: Extracts all sections from part XML
- Handles CFR DIV hierarchy: DIV1 (title) → DIV3 (chapter) → DIV5 (subchapter) → DIV6 (part) → DIV8 (section)
- Preserves metadata: section numbers, headings, text, effective dates, last amended dates
- Recursive traversal handles variations in XML structure (some titles omit subchapters)

### Environment Configuration
- Updated `Env` interface with `OPENAI_API_KEY`, `PINECONE_API_KEY`, `CONVEX_URL`
- Documented secret configuration in wrangler.jsonc (set via `wrangler secret put`)
- Secrets configured at deploy time, not in source control

---

## Technical Implementation

### API Integration Pattern
```typescript
// Retry with exponential backoff
const xml = await retryWithBackoff(
  async () => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new ECFRFetchError(response.status, titleNumber, response.statusText);
    }
    return await response.text();
  },
  'fetchCFRTitle(21)'
);
```

### XML Parsing Pattern
```typescript
// Recursive DIV traversal
function findParts(node: any): void {
  if (node['@_TYPE'] === 'PART') {
    parts.push({
      number: parseInt(node['@_N'], 10),
      name: node.HEAD?._text,
      sections: extractSections(node)
    });
  }

  // Recursively search child DIVs
  for (const key of Object.keys(node)) {
    if (key.startsWith('DIV')) {
      const childDivs = Array.isArray(node[key]) ? node[key] : [node[key]];
      childDivs.forEach(findParts);
    }
  }
}
```

### Error Handling
- Non-retryable errors: 404 (title not found)
- Retryable errors: 429 (rate limit), 5xx (server errors)
- Detailed logging for each retry attempt
- Custom error class preserves status, title, message

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Combined XML parser with fetcher module**

- **Found during:** Task 2
- **Issue:** Plan specified separate task for XML parser, but parser logic is tightly coupled to API response structure
- **Fix:** Implemented parseCFRXML, extractParts, extractSections in same fetch.ts module alongside API client
- **Rationale:** Single module reduces cognitive overhead, keeps API response handling and parsing co-located
- **Files modified:** apps/workers/src/federal/fetch.ts
- **Commit:** 7c351fe

---

## Verification Results

### TypeScript Compilation
```bash
pnpm --filter @compliance-iq/workers exec tsc --noEmit
✓ No errors
```

### Module Exports
- ✓ fetchCFRTitle exported
- ✓ fetchCFRTitleList exported
- ✓ fetchCFRPart exported
- ✓ parseCFRXML exported
- ✓ extractParts exported
- ✓ extractSections exported

### Environment Types
- ✓ Env includes OPENAI_API_KEY
- ✓ Env includes PINECONE_API_KEY
- ✓ Env includes CONVEX_URL
- ✓ Env includes DOCUMENTS_BUCKET (existing)

---

## Commits

| Hash    | Type  | Description                                      |
|---------|-------|--------------------------------------------------|
| 9c02cc3 | chore | Add environment secrets to Env types             |
| 7c351fe | feat  | Create eCFR API fetcher module with XML parser   |

**Total commits:** 2

---

## Next Phase Readiness

### Blockers
None

### Risks
- **eCFR API rate limits:** Undocumented rate limits may throttle requests. Retry logic handles 429 responses, but aggressive fetching could trigger IP blocking.
  - **Mitigation:** Start with conservative 1 request/second, monitor for 429 responses

- **XML structure variations:** CFR titles may have unexpected XML structures not covered by current parser
  - **Mitigation:** Recursive DIV traversal handles most variations, but manual testing of all 7 target titles needed

### Integration Points
- **For 02-03 (R2 Storage):** fetchCFRTitle() and fetchCFRPart() return raw XML strings ready for R2 upload
- **For 02-04 (Chunking):** parseCFRXML() returns structured CFRTitle with parts and sections for chunking logic
- **For 02-05 (Embedding):** CFRSection type includes all metadata needed for embedding (number, heading, text)

---

## Notes

- fast-xml-parser configured with `ignoreAttributes: false` to preserve effective dates and amendments from XML attributes
- Current date formatting uses UTC timezone (matches eCFR API expectations)
- Parser preserves section numbering (e.g., "§ 117.3") and subsection structure for Bluebook citations
- Error messages include title/part numbers for debugging

---

*Summary created: 2026-02-01*
*Plan file: .planning/phases/02-federal-data/02-02-PLAN.md*
