/**
 * County Source Registry
 *
 * Configuration for 10 target Texas counties based on Costco presence.
 * Research conducted 2026-02-02 to identify source availability.
 *
 * Key Findings:
 * - 9 of 10 counties have online ordinance sources
 * - Dallas County uses eLaws platform (server-rendered HTML, scrapable)
 * - Remaining 8 with sources use Municode Library (SPA, requires API/JS)
 * - All counties return HTTP 200 but Municode is JavaScript-rendered
 *
 * Platform Notes:
 * - Municode (library.municode.com): SPA architecture, may require
 *   discovering API endpoints or Playwright for full scraping
 * - eLaws (*.elaws.us): Server-rendered HTML, Cheerio-compatible
 * - American Legal: Blocks AI crawlers with Cloudflare challenge
 */

import type { CountySourceConfig } from './types';

/**
 * Target Texas Counties for MVP
 *
 * Top 10 counties by Costco presence in Texas.
 * Each entry documents research findings and source availability.
 *
 * Research Date: 2026-02-02
 */
export const TARGET_COUNTIES: CountySourceConfig[] = [
  // ============================================================================
  // HARRIS COUNTY (48201) - Houston area, largest Texas county
  // ============================================================================
  // Research: URL https://library.municode.com/tx/harris_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Confirmed accessible, code_of_ordinances path exists
  // Categories: Based on typical Texas county authority (subdivision, infrastructure)
  {
    name: 'Harris',
    fipsCode: '48201',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/harris_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'infrastructure', 'flood', 'health'],
  },

  // ============================================================================
  // DALLAS COUNTY (48113) - Dallas area
  // ============================================================================
  // Research: URL http://dallascounty-tx.elaws.us/code/coor returns 200
  // Platform: eLaws (server-rendered HTML)
  // Notes: Confirmed "Code of Ordinances, Dallas County" in page title
  // Categories: Based on typical Texas county authority
  {
    name: 'Dallas',
    fipsCode: '48113',
    platform: 'elaws',
    baseUrl: 'http://dallascounty-tx.elaws.us/code/coor',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'flood', 'health'],
  },

  // ============================================================================
  // TARRANT COUNTY (48439) - Fort Worth area
  // ============================================================================
  // Research: URL https://library.municode.com/tx/tarrant_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Accessible, code_of_ordinances path returns 200
  // Categories: Based on typical Texas county authority
  {
    name: 'Tarrant',
    fipsCode: '48439',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/tarrant_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'drainage', 'health'],
  },

  // ============================================================================
  // BEXAR COUNTY (48029) - San Antonio area
  // ============================================================================
  // Research: URL https://library.municode.com/tx/bexar_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Accessible, code_of_ordinances path returns 200
  // Categories: Based on typical Texas county authority
  {
    name: 'Bexar',
    fipsCode: '48029',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/bexar_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'flood', 'health'],
  },

  // ============================================================================
  // TRAVIS COUNTY (48453) - Austin area
  // ============================================================================
  // Research: URL https://library.municode.com/tx/travis_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Accessible, code_of_ordinances path returns 200
  // Categories: Based on typical Texas county authority
  {
    name: 'Travis',
    fipsCode: '48453',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/travis_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'flood', 'septic', 'health'],
  },

  // ============================================================================
  // COLLIN COUNTY (48085) - Plano/McKinney area
  // ============================================================================
  // Research: URL https://library.municode.com/tx/collin_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Accessible, code_of_ordinances path returns 200
  // Categories: Based on typical Texas county authority
  {
    name: 'Collin',
    fipsCode: '48085',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/collin_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'drainage', 'health'],
  },

  // ============================================================================
  // DENTON COUNTY (48121) - Denton/Lewisville area
  // ============================================================================
  // Research: URL https://library.municode.com/tx/denton_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Accessible, code_of_ordinances path returns 200
  // Categories: Based on typical Texas county authority
  {
    name: 'Denton',
    fipsCode: '48121',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/denton_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'flood', 'health'],
  },

  // ============================================================================
  // FORT BEND COUNTY (48157) - Sugar Land area
  // ============================================================================
  // Research: URL https://library.municode.com/tx/fort_bend_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Accessible, code_of_ordinances path returns 200
  // Categories: Based on typical Texas county authority
  {
    name: 'Fort Bend',
    fipsCode: '48157',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/fort_bend_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'drainage', 'flood', 'health'],
  },

  // ============================================================================
  // WILLIAMSON COUNTY (48491) - Round Rock/Georgetown area
  // ============================================================================
  // Research: URL https://library.municode.com/tx/williamson_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Accessible, code_of_ordinances path returns 200
  // Categories: Based on typical Texas county authority
  {
    name: 'Williamson',
    fipsCode: '48491',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/williamson_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'flood', 'septic', 'health'],
  },

  // ============================================================================
  // EL PASO COUNTY (48141) - El Paso area
  // ============================================================================
  // Research: URL https://library.municode.com/tx/el_paso_county returns 200
  // Platform: Municode Library (SPA)
  // Notes: Accessible, code_of_ordinances path returns 200
  // Categories: Based on typical Texas county authority
  {
    name: 'El Paso',
    fipsCode: '48141',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/el_paso_county/codes/code_of_ordinances',
    hasOnlineSource: true,
    enabled: true,
    categories: ['subdivision', 'building', 'flood', 'health'],
  },
];

/**
 * Get enabled counties (those with accessible online sources)
 *
 * @returns Array of county configs that should be processed
 *
 * @example
 * ```ts
 * const counties = getEnabledCounties();
 * // => [Harris, Dallas, Tarrant, Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso]
 * ```
 */
export function getEnabledCounties(): CountySourceConfig[] {
  return TARGET_COUNTIES.filter((c) => c.enabled);
}

/**
 * Get skipped counties (those without accessible online sources)
 *
 * @returns Array of county configs that should not be processed
 *
 * @example
 * ```ts
 * const skipped = getSkippedCounties();
 * // => [] (all 10 target counties are enabled)
 * ```
 */
export function getSkippedCounties(): CountySourceConfig[] {
  return TARGET_COUNTIES.filter((c) => !c.enabled);
}

/**
 * Get county config by name (case-insensitive)
 *
 * @param name County name (e.g., "Harris", "dallas")
 * @returns County config or undefined if not found
 *
 * @example
 * ```ts
 * const harris = getCountyByName('Harris');
 * // => { name: 'Harris', fipsCode: '48201', ... }
 *
 * const notFound = getCountyByName('Unknown');
 * // => undefined
 * ```
 */
export function getCountyByName(name: string): CountySourceConfig | undefined {
  return TARGET_COUNTIES.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Get county config by FIPS code
 *
 * @param fipsCode County FIPS code (e.g., "48201")
 * @returns County config or undefined if not found
 *
 * @example
 * ```ts
 * const harris = getCountyByFips('48201');
 * // => { name: 'Harris', fipsCode: '48201', ... }
 *
 * const notFound = getCountyByFips('00000');
 * // => undefined
 * ```
 */
export function getCountyByFips(fipsCode: string): CountySourceConfig | undefined {
  return TARGET_COUNTIES.find((c) => c.fipsCode === fipsCode);
}

/**
 * Get counties by platform type
 *
 * @param platform Platform type to filter by
 * @returns Array of counties using that platform
 *
 * @example
 * ```ts
 * const elawsCounties = getCountiesByPlatform('elaws');
 * // => [Dallas]
 *
 * const municodeCounties = getCountiesByPlatform('municode');
 * // => [Harris, Tarrant, Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso]
 * ```
 */
export function getCountiesByPlatform(
  platform: CountySourceConfig['platform']
): CountySourceConfig[] {
  return TARGET_COUNTIES.filter((c) => c.platform === platform);
}

/**
 * Get coverage statistics for county sources
 *
 * @returns Statistics about target county coverage
 *
 * @example
 * ```ts
 * const stats = getCoverageStats();
 * // => { total: 10, enabled: 10, disabled: 0, byPlatform: { municode: 9, elaws: 1 } }
 * ```
 */
export function getCoverageStats(): {
  total: number;
  enabled: number;
  disabled: number;
  byPlatform: Record<string, number>;
} {
  const enabled = TARGET_COUNTIES.filter((c) => c.enabled);
  const byPlatform: Record<string, number> = {};

  for (const county of enabled) {
    if (county.platform) {
      byPlatform[county.platform] = (byPlatform[county.platform] || 0) + 1;
    }
  }

  return {
    total: TARGET_COUNTIES.length,
    enabled: enabled.length,
    disabled: TARGET_COUNTIES.length - enabled.length,
    byPlatform,
  };
}
