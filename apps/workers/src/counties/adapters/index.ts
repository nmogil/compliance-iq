/**
 * County Adapter Factory and Exports
 *
 * Provides adapter factory function that returns the correct adapter
 * for each county based on its platform type.
 *
 * Adapters handle the heterogeneous scraping requirements across:
 * - Municode Library (9 counties): Harris, Tarrant, Bexar, Travis, Collin, Denton, Fort Bend, Williamson, El Paso
 * - eLaws (1 county): Dallas
 * - American Legal (future expansion)
 */

import { MunicodeAdapter } from './municode';
import { ElawsAdapter } from './elaws';
import { AmlegalAdapter } from './amlegal';
import { TARGET_COUNTIES, getCountyByName } from '../sources';
import type { CountyAdapter, CountyPlatform } from '../types';

// Re-export base class and utilities
export { CountyAdapterBase, loadCheerioPage } from './base';

// Re-export platform adapters
export { MunicodeAdapter } from './municode';
export { ElawsAdapter } from './elaws';
export { AmlegalAdapter } from './amlegal';

/**
 * Get the appropriate adapter for a county based on its platform type
 *
 * Looks up the county configuration and instantiates the correct
 * platform-specific adapter.
 *
 * @param countyName County name (e.g., "Harris", "Dallas")
 * @returns Adapter instance or null if county is not enabled or has no adapter
 *
 * @example
 * const adapter = getAdapterForCounty('Harris');
 * if (adapter) {
 *   for await (const ordinance of adapter.fetchOrdinances()) {
 *     console.log(ordinance.heading);
 *   }
 * }
 *
 * const dallas = getAdapterForCounty('Dallas');
 * // Returns ElawsAdapter for Dallas County
 *
 * const unknown = getAdapterForCounty('Unknown');
 * // Returns null - county not found
 */
export function getAdapterForCounty(countyName: string): CountyAdapter | null {
  const config = getCountyByName(countyName);

  if (!config) {
    console.error('[AdapterFactory] County not found: ' + countyName);
    return null;
  }

  if (!config.enabled) {
    const reason = config.skipReason ?? 'no reason given';
    console.warn('[AdapterFactory] County disabled: ' + countyName + ' (' + reason + ')');
    return null;
  }

  if (!config.baseUrl || !config.platform) {
    console.error('[AdapterFactory] County missing baseUrl or platform: ' + countyName);
    return null;
  }

  const adapterConfig = {
    county: config.name,
    fipsCode: config.fipsCode,
    baseUrl: config.baseUrl,
  };

  switch (config.platform) {
    case 'municode':
      return new MunicodeAdapter(adapterConfig);

    case 'elaws':
      return new ElawsAdapter(adapterConfig);

    case 'amlegal':
      return new AmlegalAdapter(adapterConfig);

    case 'court-orders':
      // Court order scraper not yet implemented
      console.warn('[AdapterFactory] Court orders adapter not implemented: ' + countyName);
      return null;

    case 'custom':
      // Custom adapter would need per-county implementation
      console.warn('[AdapterFactory] Custom adapter not implemented: ' + countyName);
      return null;

    default:
      console.error('[AdapterFactory] Unknown platform: ' + config.platform);
      return null;
  }
}

/**
 * Get adapters for all enabled counties
 *
 * Instantiates adapters for all counties that are enabled and have
 * a supported platform type.
 *
 * @returns Array of adapter instances for all enabled counties
 *
 * @example
 * const adapters = getAdaptersForEnabledCounties();
 * console.log('Processing ' + adapters.length + ' counties');
 *
 * for (const adapter of adapters) {
 *   console.log(adapter.county + ' (' + adapter.platform + ')');
 * }
 */
export function getAdaptersForEnabledCounties(): CountyAdapter[] {
  const adapters: CountyAdapter[] = [];

  for (const config of TARGET_COUNTIES) {
    if (config.enabled) {
      const adapter = getAdapterForCounty(config.name);
      if (adapter) {
        adapters.push(adapter);
      }
    }
  }

  return adapters;
}

/**
 * Validate source availability for all enabled counties
 *
 * Checks each enabled county's source URL and HTML structure
 * to verify the source is accessible and has not changed.
 *
 * @returns Validation results for each county
 *
 * @example
 * const results = await validateAllCountySources();
 *
 * console.log('Valid: ' + results.valid.join(', '));
 * for (const invalid of results.invalid) {
 *   console.error(invalid.county + ': ' + invalid.error);
 * }
 */
export async function validateAllCountySources(): Promise<{
  valid: string[];
  invalid: Array<{ county: string; error: string }>;
}> {
  const valid: string[] = [];
  const invalid: Array<{ county: string; error: string }> = [];

  const adapters = getAdaptersForEnabledCounties();

  for (const adapter of adapters) {
    console.log('[Validation] Checking ' + adapter.county + ' County...');

    const result = await adapter.validateSource();

    if (result.accessible) {
      valid.push(adapter.county);
      console.log('[Validation] ' + adapter.county + ' County: OK');
    } else {
      invalid.push({ county: adapter.county, error: result.error || 'Unknown error' });
      console.warn('[Validation] ' + adapter.county + ' County: FAILED - ' + result.error);
    }

    // Rate limit between validations to be polite
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return { valid, invalid };
}

/**
 * Get adapter statistics
 *
 * Returns counts of adapters by platform type and availability.
 *
 * @returns Statistics object
 */
export function getAdapterStats(): {
  total: number;
  enabled: number;
  byPlatform: Record<CountyPlatform, number>;
} {
  const stats = {
    total: TARGET_COUNTIES.length,
    enabled: 0,
    byPlatform: {
      municode: 0,
      elaws: 0,
      amlegal: 0,
      custom: 0,
      'court-orders': 0,
    } as Record<CountyPlatform, number>,
  };

  for (const config of TARGET_COUNTIES) {
    if (config.enabled && config.platform) {
      stats.enabled++;
      stats.byPlatform[config.platform]++;
    }
  }

  return stats;
}
