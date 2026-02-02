/**
 * County Ordinance Fetch Orchestrator
 *
 * Unified interface for fetching ordinances from all enabled counties
 * using platform-specific adapters. Stores fetched ordinances to R2.
 *
 * Features:
 * - Platform-agnostic fetching via adapter factory
 * - R2 storage for raw ordinance HTML
 * - Sequential processing to avoid API overload
 * - Checkpoint-based resumption for fault tolerance
 * - Source validation before fetching
 */

import {
  getAdapterForCounty,
  validateAllCountySources,
} from './adapters';
import { getEnabledCounties } from './sources';
import {
  storeCountyOrdinance,
  saveCountyCheckpoint,
  loadCountyCheckpoint,
  clearCountyCheckpoint,
} from './storage';

/**
 * Result of fetching ordinances from a single county
 */
export interface CountyFetchResult {
  /** County name */
  county: string;
  /** FIPS code */
  fipsCode: string;
  /** Number of ordinances fetched */
  ordinanceCount: number;
  /** Whether fetch was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Result of fetching ordinances from all enabled counties
 */
export interface AllCountiesFetchResult {
  /** Total ordinances fetched across all counties */
  totalOrdinances: number;
  /** Counties processed successfully */
  successfulCounties: string[];
  /** Counties that failed */
  failedCounties: Array<{ county: string; error: string }>;
  /** Individual county results */
  results: CountyFetchResult[];
  /** Total duration in milliseconds */
  durationMs: number;
}

/**
 * Fetch and store ordinances from a single county
 *
 * Uses the appropriate adapter based on county platform type and
 * stores each ordinance to R2.
 *
 * @param bucket R2 bucket instance
 * @param countyName County name (e.g., "Harris", "Dallas")
 * @returns Fetch result with ordinance count and status
 *
 * @example
 * ```typescript
 * const result = await fetchCountyOrdinances(bucket, 'Harris');
 * if (result.success) {
 *   console.log(`Fetched ${result.ordinanceCount} ordinances from Harris County`);
 * }
 * ```
 */
export async function fetchCountyOrdinances(
  bucket: R2Bucket,
  countyName: string
): Promise<CountyFetchResult> {
  const startTime = Date.now();

  // Get adapter for this county
  const adapter = getAdapterForCounty(countyName);

  if (!adapter) {
    return {
      county: countyName,
      fipsCode: 'unknown',
      ordinanceCount: 0,
      success: false,
      error: `No adapter available for county: ${countyName}`,
      durationMs: Date.now() - startTime,
    };
  }

  console.log(`[CountyFetch] Starting fetch for ${countyName} County (${adapter.platform})`);

  try {
    // Validate source is accessible
    const validation = await adapter.validateSource();
    if (!validation.accessible) {
      console.error(`[CountyFetch] Source validation failed for ${countyName}: ${validation.error}`);
      return {
        county: countyName,
        fipsCode: adapter.fipsCode,
        ordinanceCount: 0,
        success: false,
        error: `Source validation failed: ${validation.error}`,
        durationMs: Date.now() - startTime,
      };
    }

    // Fetch and store ordinances
    let ordinanceCount = 0;

    for await (const ordinance of adapter.fetchOrdinances()) {
      // Store to R2
      await storeCountyOrdinance(bucket, ordinance, ordinance.text);
      ordinanceCount++;

      if (ordinanceCount % 10 === 0) {
        console.log(`[CountyFetch] ${countyName} County: ${ordinanceCount} ordinances stored`);
      }
    }

    console.log(`[CountyFetch] Completed ${countyName} County: ${ordinanceCount} ordinances`);

    return {
      county: countyName,
      fipsCode: adapter.fipsCode,
      ordinanceCount,
      success: true,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[CountyFetch] Failed for ${countyName} County:`, message);

    return {
      county: countyName,
      fipsCode: adapter.fipsCode,
      ordinanceCount: 0,
      success: false,
      error: message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Fetch and store ordinances from all enabled counties
 *
 * Processes counties sequentially to avoid API overload and supports
 * checkpoint-based resumption for fault tolerance.
 *
 * @param bucket R2 bucket instance
 * @param options Fetch options
 * @returns Combined fetch results from all counties
 *
 * @example
 * ```typescript
 * const result = await fetchAllEnabledCounties(bucket);
 * console.log(`Total ordinances: ${result.totalOrdinances}`);
 * console.log(`Successful: ${result.successfulCounties.join(', ')}`);
 * if (result.failedCounties.length > 0) {
 *   console.log(`Failed: ${result.failedCounties.map(f => f.county).join(', ')}`);
 * }
 * ```
 */
export async function fetchAllEnabledCounties(
  bucket: R2Bucket,
  options: {
    /** Whether to resume from checkpoint if available */
    resumeFromCheckpoint?: boolean;
    /** Whether to validate all sources before fetching */
    validateFirst?: boolean;
  } = {}
): Promise<AllCountiesFetchResult> {
  const { resumeFromCheckpoint = true, validateFirst = false } = options;
  const startTime = Date.now();

  const results: CountyFetchResult[] = [];
  const successfulCounties: string[] = [];
  const failedCounties: Array<{ county: string; error: string }> = [];
  let totalOrdinances = 0;

  // Get list of enabled counties
  const enabledCounties = getEnabledCounties();

  console.log(`[CountyFetch] Processing ${enabledCounties.length} enabled counties`);

  // Validate all sources first if requested
  if (validateFirst) {
    console.log('[CountyFetch] Validating all county sources...');
    const validation = await validateAllCountySources();

    if (validation.invalid.length > 0) {
      console.warn(
        `[CountyFetch] ${validation.invalid.length} counties have invalid sources:`,
        validation.invalid.map((i) => i.county).join(', ')
      );
    }
  }

  // Check for existing checkpoint
  let startIndex = 0;
  if (resumeFromCheckpoint) {
    const checkpoint = await loadCountyCheckpoint(bucket);
    if (checkpoint && checkpoint.status === 'in_progress' && checkpoint.lastProcessedCounty) {
      const lastIndex = enabledCounties.findIndex(
        (c) => c.name === checkpoint.lastProcessedCounty
      );
      if (lastIndex >= 0) {
        startIndex = lastIndex + 1;
        totalOrdinances = checkpoint.chunksProcessed;
        console.log(
          `[CountyFetch] Resuming from checkpoint after ${checkpoint.lastProcessedCounty} (${startIndex}/${enabledCounties.length})`
        );
      }
    }
  }

  // Process each county sequentially
  for (let i = startIndex; i < enabledCounties.length; i++) {
    const county = enabledCounties[i];
    if (!county) continue;

    console.log(`[CountyFetch] Processing ${county.name} County (${i + 1}/${enabledCounties.length})`);

    const result = await fetchCountyOrdinances(bucket, county.name);
    results.push(result);

    if (result.success) {
      successfulCounties.push(county.name);
      totalOrdinances += result.ordinanceCount;
    } else {
      failedCounties.push({ county: county.name, error: result.error ?? 'Unknown error' });
    }

    // Save checkpoint after each county
    await saveCountyCheckpoint(bucket, {
      sourceType: 'county',
      lastProcessedCounty: county.name,
      timestamp: new Date().toISOString(),
      chunksProcessed: totalOrdinances,
      status: 'in_progress',
    });

    // Small delay between counties to be polite
    if (i < enabledCounties.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  // Clear checkpoint on successful completion
  if (failedCounties.length === 0) {
    await clearCountyCheckpoint(bucket);
    console.log('[CountyFetch] All counties processed successfully, checkpoint cleared');
  } else {
    // Update checkpoint to completed (with errors)
    await saveCountyCheckpoint(bucket, {
      sourceType: 'county',
      lastProcessedCounty: enabledCounties[enabledCounties.length - 1]?.name,
      timestamp: new Date().toISOString(),
      chunksProcessed: totalOrdinances,
      status: 'completed',
      error: `${failedCounties.length} counties failed`,
    });
    console.log(`[CountyFetch] Processing complete with ${failedCounties.length} failures`);
  }

  return {
    totalOrdinances,
    successfulCounties,
    failedCounties,
    results,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Validate all county sources before fetching
 *
 * Checks each enabled county's source URL and HTML structure
 * to verify accessibility and expected format.
 *
 * @returns Validation results for each county
 *
 * @example
 * ```typescript
 * const validation = await validateCountySources();
 *
 * if (validation.invalid.length > 0) {
 *   console.error('Some county sources are unavailable:');
 *   for (const invalid of validation.invalid) {
 *     console.error(`  ${invalid.county}: ${invalid.error}`);
 *   }
 * } else {
 *   console.log('All county sources valid');
 * }
 * ```
 */
export async function validateCountySources(): Promise<{
  valid: string[];
  invalid: Array<{ county: string; error: string }>;
}> {
  console.log('[CountyFetch] Validating county sources...');
  return validateAllCountySources();
}

/**
 * Get fetch statistics for enabled counties
 *
 * @returns Statistics about enabled counties and their platforms
 */
export function getFetchStats(): {
  totalEnabled: number;
  byPlatform: Record<string, number>;
  counties: string[];
} {
  const enabledCounties = getEnabledCounties();

  const byPlatform: Record<string, number> = {};
  for (const county of enabledCounties) {
    if (county.platform) {
      byPlatform[county.platform] = (byPlatform[county.platform] ?? 0) + 1;
    }
  }

  return {
    totalEnabled: enabledCounties.length,
    byPlatform,
    counties: enabledCounties.map((c) => c.name),
  };
}
