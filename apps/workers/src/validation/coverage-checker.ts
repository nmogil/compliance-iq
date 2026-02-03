/**
 * Coverage Checker
 *
 * Validates that all target jurisdictions have been processed and indexed.
 * Queries Pinecone to compare actual indexed coverage against expected target lists.
 *
 * Key Functions:
 * - getIndexedJurisdictions: Query Pinecone for distinct jurisdictions by sourceType
 * - check*Coverage: Compare indexed data against target lists (federal, county, municipal)
 * - checkCoverage: Aggregate coverage across all source types
 * - identifyGaps: Extract missing jurisdictions for reporting
 *
 * Note on Pinecone queries:
 * Pinecone doesn't provide a distinct() operation. We use a dummy query vector
 * (3072-dim zeros) with high topK (10000) to sample vectors and extract unique
 * jurisdictions from metadata. For production datasets with >10K vectors per
 * sourceType, consider paginating or tracking indexed jurisdictions separately.
 */

import type { Index } from '@pinecone-database/pinecone';
import type {
  CoverageReport,
  JurisdictionCoverage,
} from './types';
import { TARGET_TITLES } from '../federal/types';
import { getEnabledCounties } from '../counties/sources';
import { getEnabledCities } from '../municipal/cities';

/**
 * Gap in coverage - jurisdiction that should be indexed but isn't.
 */
export interface Gap {
  /** Jurisdiction identifier */
  jurisdiction: string;
  /** Source type */
  sourceType: string;
  /** Reason for the gap */
  reason: string;
}

/**
 * Get indexed jurisdictions from Pinecone for a given sourceType.
 *
 * Uses a dummy query vector to sample vectors and extract unique jurisdictions
 * from metadata. This is a workaround for Pinecone's lack of distinct() operation.
 *
 * Limitations:
 * - topK=10000 means we sample max 10,000 vectors per sourceType
 * - If a sourceType has >10K vectors, some jurisdictions might be missed
 * - For production use with large datasets, consider paginating queries
 *   or maintaining a separate jurisdiction tracking system
 *
 * @param index Pinecone index instance
 * @param sourceType Source type to filter by ('federal', 'state', 'county', 'municipal')
 * @returns Array of unique jurisdiction identifiers
 *
 * @example
 * ```ts
 * const federalJurisdictions = await getIndexedJurisdictions(index, 'federal');
 * // => ['US']
 *
 * const countyJurisdictions = await getIndexedJurisdictions(index, 'county');
 * // => ['TX-48201', 'TX-48113', 'TX-48439', ...]
 * ```
 */
export async function getIndexedJurisdictions(
  index: Index,
  sourceType: string
): Promise<string[]> {
  // Create dummy query vector (3072 dimensions of zeros)
  const dummyVector = new Array(3072).fill(0);

  // Query Pinecone with high topK to sample vectors
  const results = await index.query({
    vector: dummyVector,
    topK: 10000,
    filter: { sourceType },
    includeMetadata: true,
  });

  // Extract jurisdiction from each match
  const jurisdictions = results.matches.map((match) => match.metadata?.jurisdiction);

  // Dedupe using Set and filter out any undefined/null values
  const filtered = jurisdictions.filter(Boolean);
  const uniqueSet = new Set(filtered);
  const uniqueJurisdictions = Array.from(uniqueSet);

  return uniqueJurisdictions as string[];
}

/**
 * Check coverage for federal CFR titles.
 *
 * Compares indexed federal jurisdictions against TARGET_TITLES to determine
 * which titles have been processed.
 *
 * Note: Federal data uses jurisdiction='US' for all titles. We can verify
 * that federal data exists but cannot determine which specific titles are missing
 * without querying by other metadata fields (e.g., sourceId pattern).
 *
 * @param index Pinecone index instance
 * @returns Coverage status for each target federal title
 *
 * @example
 * ```ts
 * const federalCoverage = await checkFederalCoverage(index);
 * // => [
 * //   { name: 'Title 7: Agriculture', identifier: 'US', expected: true, indexed: true, vectorCount: 1234, status: 'active' },
 * //   ...
 * // ]
 * ```
 */
export async function checkFederalCoverage(
  index: Index
): Promise<JurisdictionCoverage[]> {
  // Get indexed federal jurisdictions
  const indexedJurisdictions = await getIndexedJurisdictions(index, 'federal');

  // Federal data uses jurisdiction='US'
  const federalIndexed = indexedJurisdictions.includes('US');

  // For federal, we track at the title level but all use jurisdiction='US'
  // We'll return one entry per target title, but all will share the same indexed status
  const coverage: JurisdictionCoverage[] = TARGET_TITLES.map((title) => ({
    name: `Title ${title.number}: ${title.name}`,
    identifier: 'US',
    expected: title.enabled,
    indexed: federalIndexed,
    vectorCount: 0, // Would need separate query to count vectors per title
    status: federalIndexed ? 'active' : 'missing',
  }));

  return coverage;
}

/**
 * Check coverage for Texas counties.
 *
 * Compares indexed county jurisdictions against enabled counties from sources.ts.
 * Matches by jurisdiction format 'TX-{fipsCode}'.
 *
 * @param index Pinecone index instance
 * @returns Coverage status for each target county
 *
 * @example
 * ```ts
 * const countyCoverage = await checkCountyCoverage(index);
 * // => [
 * //   { name: 'Harris', identifier: 'TX-48201', expected: true, indexed: true, vectorCount: 456, status: 'active' },
 * //   { name: 'Dallas', identifier: 'TX-48113', expected: true, indexed: false, vectorCount: 0, status: 'missing' },
 * //   ...
 * // ]
 * ```
 */
export async function checkCountyCoverage(
  index: Index
): Promise<JurisdictionCoverage[]> {
  // Get indexed county jurisdictions
  const indexedJurisdictions = await getIndexedJurisdictions(index, 'county');

  // Get target counties
  const targetCounties = getEnabledCounties();

  // Build coverage report
  const coverage: JurisdictionCoverage[] = targetCounties.map((county) => {
    const jurisdiction = `TX-${county.fipsCode}`;
    const indexed = indexedJurisdictions.includes(jurisdiction);

    return {
      name: county.name,
      identifier: jurisdiction,
      expected: true,
      indexed,
      vectorCount: 0, // Would need separate query to count vectors per county
      status: indexed ? 'active' : 'missing',
    };
  });

  return coverage;
}

/**
 * Check coverage for Texas municipalities.
 *
 * Compares indexed municipal jurisdictions against enabled cities from cities.ts.
 * Matches by jurisdiction format 'TX-{cityId}'.
 *
 * @param index Pinecone index instance
 * @returns Coverage status for each target city
 *
 * @example
 * ```ts
 * const municipalCoverage = await checkMunicipalCoverage(index);
 * // => [
 * //   { name: 'Houston', identifier: 'TX-houston', expected: true, indexed: true, vectorCount: 789, status: 'active' },
 * //   { name: 'Dallas', identifier: 'TX-dallas', expected: true, indexed: false, vectorCount: 0, status: 'missing' },
 * //   ...
 * // ]
 * ```
 */
export async function checkMunicipalCoverage(
  index: Index
): Promise<JurisdictionCoverage[]> {
  // Get indexed municipal jurisdictions
  const indexedJurisdictions = await getIndexedJurisdictions(index, 'municipal');

  // Get target cities
  const targetCities = getEnabledCities();

  // Build coverage report
  const coverage: JurisdictionCoverage[] = targetCities.map((city) => {
    const jurisdiction = `TX-${city.cityId}`;
    const indexed = indexedJurisdictions.includes(jurisdiction);

    return {
      name: city.name,
      identifier: jurisdiction,
      expected: true,
      indexed,
      vectorCount: 0, // Would need separate query to count vectors per city
      status: indexed ? 'active' : 'missing',
    };
  });

  return coverage;
}

/**
 * Check state coverage (Texas statutes/TAC).
 *
 * State data uses jurisdiction='TX' and sourceType='state'.
 * We can verify that state data exists but cannot easily determine
 * which specific codes (statutes vs TAC) or titles are missing without
 * querying by sourceId patterns.
 *
 * @param index Pinecone index instance
 * @returns Coverage status for Texas state data
 *
 * @example
 * ```ts
 * const stateCoverage = await checkStateCoverage(index);
 * // => [
 * //   { name: 'Texas', identifier: 'TX', expected: true, indexed: true, vectorCount: 0, status: 'active' }
 * // ]
 * ```
 */
export async function checkStateCoverage(
  index: Index
): Promise<JurisdictionCoverage[]> {
  // Get indexed state jurisdictions
  const indexedJurisdictions = await getIndexedJurisdictions(index, 'state');

  // State data uses jurisdiction='TX'
  const stateIndexed = indexedJurisdictions.includes('TX');

  return [
    {
      name: 'Texas',
      identifier: 'TX',
      expected: true,
      indexed: stateIndexed,
      vectorCount: 0, // Would need separate query to count state vectors
      status: stateIndexed ? 'active' : 'missing',
    },
  ];
}

/**
 * Check coverage across all jurisdiction types.
 *
 * Aggregates coverage from federal, state, county, and municipal sources
 * into a comprehensive CoverageReport with totals and percentages.
 *
 * @param index Pinecone index instance
 * @returns Complete coverage report across all source types
 *
 * @example
 * ```ts
 * const report = await checkCoverage(index);
 * // => {
 * //   generatedAt: '2026-02-03T00:45:00Z',
 * //   totalExpected: 38,
 * //   totalIndexed: 31,
 * //   coveragePercent: 81.58,
 * //   bySourceType: {
 * //     federal: { expected: 7, indexed: 7 },
 * //     state: { expected: 1, indexed: 1 },
 * //     county: { expected: 10, indexed: 8 },
 * //     municipal: { expected: 20, indexed: 15 }
 * //   },
 * //   jurisdictions: [...],
 * //   gaps: [...]
 * // }
 * ```
 */
export async function checkCoverage(index: Index): Promise<CoverageReport> {
  // Query all source types in parallel
  const [federalCoverage, stateCoverage, countyCoverage, municipalCoverage] =
    await Promise.all([
      checkFederalCoverage(index),
      checkStateCoverage(index),
      checkCountyCoverage(index),
      checkMunicipalCoverage(index),
    ]);

  // Combine all jurisdictions
  const allJurisdictions = [
    ...federalCoverage,
    ...stateCoverage,
    ...countyCoverage,
    ...municipalCoverage,
  ];

  // Calculate totals
  const totalExpected = allJurisdictions.filter((j) => j.expected).length;
  const totalIndexed = allJurisdictions.filter((j) => j.indexed).length;
  const coveragePercent =
    totalExpected > 0 ? (totalIndexed / totalExpected) * 100 : 0;

  // Calculate per-source-type breakdowns
  const federalExpected = federalCoverage.filter((j) => j.expected).length;
  const federalIndexed = federalCoverage.filter((j) => j.indexed).length;

  const stateExpected = stateCoverage.filter((j) => j.expected).length;
  const stateIndexed = stateCoverage.filter((j) => j.indexed).length;

  const countyExpected = countyCoverage.filter((j) => j.expected).length;
  const countyIndexed = countyCoverage.filter((j) => j.indexed).length;

  const municipalExpected = municipalCoverage.filter((j) => j.expected).length;
  const municipalIndexed = municipalCoverage.filter((j) => j.indexed).length;

  // Build coverage report
  const report: CoverageReport = {
    generatedAt: new Date().toISOString(),
    totalExpected,
    totalIndexed,
    coveragePercent: Math.round(coveragePercent * 100) / 100, // Round to 2 decimals
    bySourceType: {
      federal: { expected: federalExpected, indexed: federalIndexed },
      state: { expected: stateExpected, indexed: stateIndexed },
      county: { expected: countyExpected, indexed: countyIndexed },
      municipal: { expected: municipalExpected, indexed: municipalIndexed },
    },
    jurisdictions: allJurisdictions,
    gaps: [], // Will be populated by identifyGaps
  };

  return report;
}

/**
 * Identify coverage gaps from a CoverageReport.
 *
 * Extracts jurisdictions where expected=true but indexed=false,
 * providing human-readable reasons for each gap.
 *
 * @param coverageReport Coverage report from checkCoverage
 * @returns Array of gaps with jurisdiction, sourceType, and reason
 *
 * @example
 * ```ts
 * const report = await checkCoverage(index);
 * const gaps = identifyGaps(report);
 * // => [
 * //   { jurisdiction: 'TX-48113', sourceType: 'county', reason: 'Dallas County not indexed' },
 * //   { jurisdiction: 'TX-dallas', sourceType: 'municipal', reason: 'Dallas not indexed' },
 * //   ...
 * // ]
 * ```
 */
export function identifyGaps(coverageReport: CoverageReport): Gap[] {
  const gaps: Gap[] = [];

  for (const jurisdiction of coverageReport.jurisdictions) {
    // Skip if not expected or already indexed
    if (!jurisdiction.expected || jurisdiction.indexed) {
      continue;
    }

    // Determine source type from identifier pattern
    let sourceType = 'unknown';
    let reason = `${jurisdiction.name} not indexed`;

    if (jurisdiction.identifier === 'US') {
      sourceType = 'federal';
      reason = `Federal ${jurisdiction.name} not indexed`;
    } else if (jurisdiction.identifier === 'TX') {
      sourceType = 'state';
      reason = 'Texas state data not indexed';
    } else if (jurisdiction.identifier.match(/^TX-\d{5}$/)) {
      sourceType = 'county';
      reason = `${jurisdiction.name} County not indexed`;
    } else if (jurisdiction.identifier.match(/^TX-[a-z_]+$/)) {
      sourceType = 'municipal';
      reason = `${jurisdiction.name} not indexed`;
    }

    gaps.push({
      jurisdiction: jurisdiction.identifier,
      sourceType,
      reason,
    });
  }

  return gaps;
}
