/**
 * Texas Municipal City Registry
 *
 * Configuration for 20 target Texas cities based on population.
 * Research conducted 2026-02-02 to identify source availability.
 *
 * Key Findings:
 * - 17 cities use Municode Library (library.municode.com) - React SPA
 * - 3 cities use American Legal Publishing (codelibrary.amlegal.com)
 * - All cities scraped uniformly via Firecrawl API with markdown output
 *
 * Platform Notes:
 * - Municode: SPA architecture, requires 2000ms waitFor for JS rendering
 * - American Legal: Server-rendered, requires 1000ms waitFor
 * - Firecrawl handles both platforms uniformly with markdown output
 */

import type { MunicipalCityConfig } from './types';

/**
 * Target Texas Cities for MVP
 *
 * Top 20 cities by population in Texas.
 * Each entry documents platform and Firecrawl configuration.
 *
 * Research Date: 2026-02-02
 */
export const TEXAS_CITIES: MunicipalCityConfig[] = [
  // ============================================================================
  // MUNICODE CITIES (17 total)
  // ============================================================================

  // Population rank: 1 (Houston - 2.3M)
  {
    name: 'Houston',
    cityId: 'houston',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/houston/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 2 (San Antonio - 1.5M)
  {
    name: 'San Antonio',
    cityId: 'san_antonio',
    platform: 'municode',
    baseUrl:
      'https://library.municode.com/tx/san_antonio/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 4 (Austin - 978K)
  {
    name: 'Austin',
    cityId: 'austin',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/austin/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 6 (El Paso - 678K)
  {
    name: 'El Paso',
    cityId: 'el_paso',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/el_paso/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 7 (Arlington - 394K)
  {
    name: 'Arlington',
    cityId: 'arlington',
    platform: 'municode',
    baseUrl:
      'https://library.municode.com/tx/arlington/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 9 (Plano - 285K)
  {
    name: 'Plano',
    cityId: 'plano',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/plano/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 10 (Corpus Christi - 317K)
  {
    name: 'Corpus Christi',
    cityId: 'corpus_christi',
    platform: 'municode',
    baseUrl:
      'https://library.municode.com/tx/corpus_christi/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 11 (Lubbock - 264K)
  {
    name: 'Lubbock',
    cityId: 'lubbock',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/lubbock/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 12 (Laredo - 255K)
  {
    name: 'Laredo',
    cityId: 'laredo',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/laredo/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 13 (Irving - 256K)
  {
    name: 'Irving',
    cityId: 'irving',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/irving/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 14 (Garland - 239K)
  {
    name: 'Garland',
    cityId: 'garland',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/garland/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 15 (Frisco - 200K)
  {
    name: 'Frisco',
    cityId: 'frisco',
    platform: 'municode',
    baseUrl: 'https://library.municode.com/tx/frisco/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 16 (McKinney - 195K)
  {
    name: 'McKinney',
    cityId: 'mckinney',
    platform: 'municode',
    baseUrl:
      'https://library.municode.com/tx/mckinney/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 17 (Amarillo - 199K)
  {
    name: 'Amarillo',
    cityId: 'amarillo',
    platform: 'municode',
    baseUrl:
      'https://library.municode.com/tx/amarillo/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 18 (Grand Prairie - 196K)
  {
    name: 'Grand Prairie',
    cityId: 'grand_prairie',
    platform: 'municode',
    baseUrl:
      'https://library.municode.com/tx/grand_prairie/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 19 (Brownsville - 186K)
  {
    name: 'Brownsville',
    cityId: 'brownsville',
    platform: 'municode',
    baseUrl:
      'https://library.municode.com/tx/brownsville/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // Population rank: 20 (Pasadena - 151K)
  {
    name: 'Pasadena',
    cityId: 'pasadena',
    platform: 'municode',
    baseUrl:
      'https://library.municode.com/tx/pasadena/codes/code_of_ordinances',
    enabled: true,
    firecrawlConfig: { waitFor: 2000, onlyMainContent: true },
  },

  // ============================================================================
  // AMERICAN LEGAL CITIES (3 total)
  // ============================================================================

  // Population rank: 3 (Dallas - 1.3M)
  {
    name: 'Dallas',
    cityId: 'dallas',
    platform: 'amlegal',
    baseUrl:
      'https://codelibrary.amlegal.com/codes/dallas/latest/dallas_tx/0-0-0-1',
    enabled: true,
    firecrawlConfig: { waitFor: 1000, onlyMainContent: true },
  },

  // Population rank: 5 (Fort Worth - 918K)
  {
    name: 'Fort Worth',
    cityId: 'fort_worth',
    platform: 'amlegal',
    baseUrl:
      'https://codelibrary.amlegal.com/codes/ftworth/latest/ftworth_tx/0-0-0-1',
    enabled: true,
    firecrawlConfig: { waitFor: 1000, onlyMainContent: true },
  },

  // Population rank: 8 (Killeen - 153K)
  {
    name: 'Killeen',
    cityId: 'killeen',
    platform: 'amlegal',
    baseUrl:
      'https://codelibrary.amlegal.com/codes/killeen/latest/killeen_tx/0-0-0-1',
    enabled: true,
    firecrawlConfig: { waitFor: 1000, onlyMainContent: true },
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get enabled cities (those configured for scraping)
 *
 * @returns Array of city configs that should be processed
 *
 * @example
 * ```ts
 * const cities = getEnabledCities();
 * // => [Houston, San Antonio, Dallas, Austin, ...]
 * ```
 */
export function getEnabledCities(): MunicipalCityConfig[] {
  return TEXAS_CITIES.filter((c) => c.enabled);
}

/**
 * Get skipped cities (disabled with documented reason)
 *
 * @returns Array of city configs that should not be processed
 *
 * @example
 * ```ts
 * const skipped = getSkippedCities();
 * // => [] (all 20 target cities are enabled)
 * ```
 */
export function getSkippedCities(): MunicipalCityConfig[] {
  return TEXAS_CITIES.filter((c) => !c.enabled);
}

/**
 * Get city config by cityId (URL-safe identifier)
 *
 * @param cityId City identifier (e.g., "houston", "san_antonio")
 * @returns City config or undefined if not found
 *
 * @example
 * ```ts
 * const houston = getCityById('houston');
 * // => { name: 'Houston', cityId: 'houston', platform: 'municode', ... }
 *
 * const notFound = getCityById('unknown');
 * // => undefined
 * ```
 */
export function getCityById(cityId: string): MunicipalCityConfig | undefined {
  return TEXAS_CITIES.find((c) => c.cityId === cityId);
}

/**
 * Get city config by display name (case-insensitive)
 *
 * @param name City name (e.g., "Houston", "DALLAS")
 * @returns City config or undefined if not found
 *
 * @example
 * ```ts
 * const houston = getCityByName('Houston');
 * // => { name: 'Houston', cityId: 'houston', ... }
 *
 * const dallas = getCityByName('DALLAS');
 * // => { name: 'Dallas', cityId: 'dallas', ... }
 * ```
 */
export function getCityByName(name: string): MunicipalCityConfig | undefined {
  return TEXAS_CITIES.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Get cities using Municode platform
 *
 * @returns Array of cities using library.municode.com
 *
 * @example
 * ```ts
 * const municodeCities = getMunicodeCities();
 * // => [Houston, San Antonio, Austin, El Paso, ...] (17 cities)
 * ```
 */
export function getMunicodeCities(): MunicipalCityConfig[] {
  return TEXAS_CITIES.filter((c) => c.platform === 'municode');
}

/**
 * Get cities using American Legal platform
 *
 * @returns Array of cities using codelibrary.amlegal.com
 *
 * @example
 * ```ts
 * const amlegalCities = getAmlegalCities();
 * // => [Dallas, Fort Worth, Killeen] (3 cities)
 * ```
 */
export function getAmlegalCities(): MunicipalCityConfig[] {
  return TEXAS_CITIES.filter((c) => c.platform === 'amlegal');
}

/**
 * Get coverage statistics for municipal sources
 *
 * @returns Statistics about target city coverage
 *
 * @example
 * ```ts
 * const stats = getCoverageStats();
 * // => { total: 20, enabled: 20, disabled: 0, byPlatform: { municode: 17, amlegal: 3 } }
 * ```
 */
export function getCoverageStats(): {
  total: number;
  enabled: number;
  disabled: number;
  byPlatform: Record<string, number>;
} {
  const enabled = TEXAS_CITIES.filter((c) => c.enabled);
  const byPlatform: Record<string, number> = {};

  for (const city of TEXAS_CITIES) {
    byPlatform[city.platform] = (byPlatform[city.platform] || 0) + 1;
  }

  return {
    total: TEXAS_CITIES.length,
    enabled: enabled.length,
    disabled: TEXAS_CITIES.length - enabled.length,
    byPlatform,
  };
}
