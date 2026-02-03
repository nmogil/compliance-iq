---
phase: 06-data-processing
plan: 04
subsystem: validation
status: complete
tags: [coverage, validation, pinecone, quality]
requires: ["06-01", "02-06", "03-06", "04-06", "05-06"]
provides:
  - "Coverage validation against target lists"
  - "Gap identification for missing jurisdictions"
  - "Multi-source coverage aggregation"
affects: ["06-05", "06-06"]
tech-stack:
  added: []
  patterns: ["Pinecone sampling pattern", "Dummy vector queries", "Set-based deduplication"]
key-files:
  created:
    - "apps/workers/src/validation/coverage-checker.ts"
  modified:
    - "apps/workers/src/validation/index.ts"
decisions:
  - id: "dummy-vector-sampling"
    context: "Pinecone lacks distinct() operation for metadata fields"
    decision: "Use 3072-dim zero vector with topK=10000 to sample and deduplicate jurisdictions"
    rationale: "Workaround for platform limitation; documented for production scaling"
    alternatives: ["Separate jurisdiction tracking system", "Pagination for large datasets"]
  - id: "federal-coverage-limitation"
    context: "All federal titles share jurisdiction='US'"
    decision: "Report federal coverage at aggregate level, not per-title"
    rationale: "Cannot distinguish missing titles without querying sourceId patterns"
    alternatives: ["Query by sourceId prefix", "Maintain separate title tracking"]
  - id: "jurisdiction-format-patterns"
    context: "Each source type uses different jurisdiction identifier format"
    decision: "Use pattern matching: 'US' (federal), 'TX' (state), 'TX-{fipsCode}' (county), 'TX-{cityId}' (municipal)"
    rationale: "Consistent with existing pipeline conventions from phases 2-5"
    alternatives: ["Unified jurisdiction format", "Separate sourceType fields"]
metrics:
  duration: "125 seconds"
  complexity: "medium"
  files-changed: 2
  lines-added: 411
  completed: "2026-02-03"
---

# Phase 6 Plan 4: Coverage Checker Summary

**One-liner:** Pinecone coverage validation comparing indexed jurisdictions against TARGET_TITLES, enabled counties, and enabled cities with gap reporting

## What Was Built

### Core Coverage Functions

**getIndexedJurisdictions(index, sourceType)**
- Queries Pinecone using dummy 3072-dim zero vector
- Filters by sourceType metadata field
- topK=10000 samples up to 10,000 vectors per source type
- Deduplicates jurisdictions using Set
- Returns unique jurisdiction identifiers
- **Limitation:** May miss jurisdictions if >10K vectors per sourceType (documented for production)

**checkFederalCoverage(index)**
- Queries for sourceType='federal' indexed jurisdictions
- Compares against TARGET_TITLES (7 CFR titles)
- All federal data uses jurisdiction='US'
- Returns one JurisdictionCoverage entry per target title
- Status: 'active' if any federal data exists, 'missing' otherwise
- **Note:** Cannot distinguish which specific titles are missing without sourceId queries

**checkStateCoverage(index)**
- Queries for sourceType='state' indexed jurisdictions
- Validates Texas state data exists (jurisdiction='TX')
- Returns single JurisdictionCoverage entry for Texas
- **Note:** Cannot distinguish statutes vs TAC without sourceId queries

**checkCountyCoverage(index)**
- Queries for sourceType='county' indexed jurisdictions
- Compares against getEnabledCounties() (10 Texas counties)
- Matches by jurisdiction format 'TX-{fipsCode}'
- Returns JurisdictionCoverage per county with indexed status
- Status: 'active' if indexed, 'missing' otherwise

**checkMunicipalCoverage(index)**
- Queries for sourceType='municipal' indexed jurisdictions
- Compares against getEnabledCities() (20 Texas cities)
- Matches by jurisdiction format 'TX-{cityId}'
- Returns JurisdictionCoverage per city with indexed status
- Status: 'active' if indexed, 'missing' otherwise

**checkCoverage(index)**
- Calls all check*Coverage functions in parallel
- Aggregates into CoverageReport with:
  - totalExpected, totalIndexed, coveragePercent
  - bySourceType breakdown (federal/state/county/municipal)
  - jurisdictions array with all coverage details
  - gaps array (populated by identifyGaps)
- Calculates percentages rounded to 2 decimals

**identifyGaps(coverageReport)**
- Extracts jurisdictions where expected=true but indexed=false
- Determines sourceType from identifier pattern:
  - 'US' → federal
  - 'TX' → state
  - 'TX-\d{5}' → county
  - 'TX-[a-z_]+' → municipal
- Returns Gap array with jurisdiction, sourceType, and human-readable reason

### Module Integration

**Updated validation/index.ts:**
- Added export for coverage-checker
- Added exports for token-analyzer and metadata-validator (wave 1 modules)
- All validation utilities now accessible from single import

## Technical Implementation

### Pinecone Sampling Pattern

**Challenge:** Pinecone doesn't provide distinct() operation for metadata fields.

**Solution:**
1. Create dummy query vector (3072 dimensions of zeros)
2. Query with high topK (10000) and sourceType filter
3. Extract jurisdiction from each match metadata
4. Deduplicate using Set and Array.from
5. Return unique jurisdictions

**Trade-offs:**
- ✅ Works with current Pinecone API
- ✅ Single query per source type
- ❌ Limited to topK sample size (10,000)
- ❌ May miss jurisdictions in large datasets
- ⚠️ Not suitable for production scale without pagination

### Jurisdiction Identifier Patterns

| Source Type | Format | Example | Purpose |
|-------------|--------|---------|---------|
| Federal | `US` | `US` | All CFR titles share jurisdiction |
| State | `TX` | `TX` | All statutes/TAC share jurisdiction |
| County | `TX-{fipsCode}` | `TX-48201` | Harris County (FIPS 48201) |
| Municipal | `TX-{cityId}` | `TX-houston` | Houston (cityId from registry) |

Pattern matching in identifyGaps uses regex to classify gaps by sourceType.

### Coverage Report Structure

```typescript
CoverageReport {
  generatedAt: "2026-02-03T00:46:00Z",
  totalExpected: 38,     // 7 federal + 1 state + 10 county + 20 municipal
  totalIndexed: 31,
  coveragePercent: 81.58,
  bySourceType: {
    federal: { expected: 7, indexed: 7 },
    state: { expected: 1, indexed: 1 },
    county: { expected: 10, indexed: 8 },
    municipal: { expected: 20, indexed: 15 }
  },
  jurisdictions: [...],
  gaps: [...]
}
```

## Files Created

### apps/workers/src/validation/coverage-checker.ts (408 lines)

**Exports:**
- `getIndexedJurisdictions(index, sourceType)` - Query Pinecone for distinct jurisdictions
- `checkFederalCoverage(index)` - Validate CFR title coverage
- `checkStateCoverage(index)` - Validate Texas state data coverage
- `checkCountyCoverage(index)` - Validate county coverage
- `checkMunicipalCoverage(index)` - Validate municipal coverage
- `checkCoverage(index)` - Aggregate all coverage types
- `identifyGaps(coverageReport)` - Extract missing jurisdictions
- `Gap` interface - Gap type definition

**Key Functions:**

1. **getIndexedJurisdictions:** Pinecone sampling with dummy vector
2. **check*Coverage:** Compare indexed vs target lists
3. **checkCoverage:** Parallel queries with aggregation
4. **identifyGaps:** Pattern-based gap classification

**Documentation:**
- JSDoc for all public functions
- Examples for each function
- Limitations clearly documented (topK, federal/state granularity)
- Production scaling notes

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

### Blockers

None.

### Dependencies Delivered

- **Coverage validation (COV-01):** checkCoverage validates all source types
- **Gap identification:** identifyGaps provides actionable missing jurisdiction list
- **Target list integration:** Uses TARGET_TITLES, getEnabledCounties, getEnabledCities

### Concerns

1. **Production scaling:** topK=10000 limitation may miss jurisdictions in large datasets
   - **Mitigation:** Document limitation, consider pagination or separate tracking in Phase 7
2. **Federal/state granularity:** Cannot identify specific missing titles/codes
   - **Mitigation:** Acceptable for MVP; sourceId queries could be added later
3. **Vector count accuracy:** vectorCount field always returns 0 (would need separate queries)
   - **Mitigation:** Not critical for coverage validation; counts can be added if needed

### Next Steps

**For 06-05 (R2 Storage Validation):**
- Coverage checker provides jurisdiction list for R2 folder verification
- Gap identification feeds into missing data detection

**For 06-06 (End-to-End Validation):**
- Coverage report integrates into overall ValidationResult
- Gap list drives pipeline retry logic

**For Production:**
- Consider pagination for getIndexedJurisdictions if datasets exceed 10K vectors per sourceType
- Add sourceId pattern queries for federal/state title-level coverage
- Add vector count queries if needed for monitoring

## Testing Notes

**Manual validation:**
1. Ensure TypeScript compilation passes
2. Verify TARGET_TITLES import resolves (7 titles)
3. Verify getEnabledCounties resolves (10 counties)
4. Verify getEnabledCities resolves (20 cities)
5. Confirm Gap type matches CoverageReport.gaps structure

**Integration testing (for 06-06):**
- Query empty Pinecone index → expect all gaps
- Query partially indexed Pinecone → expect partial coverage
- Query fully indexed Pinecone → expect 100% coverage

## Metadata

**Commits:**
- `66582bc` - feat(06-04): create coverage checker for jurisdiction validation
- `e3b62bf` - feat(06-04): export coverage checker from validation module

**Time:** 125 seconds (2 tasks)

**Verification:** TypeScript compilation passes, all imports resolve

**Dependencies:**
- Pinecone SDK (@pinecone-database/pinecone)
- Federal types (TARGET_TITLES)
- County sources (getEnabledCounties)
- Municipal cities (getEnabledCities)
- Validation types (CoverageReport, JurisdictionCoverage)
