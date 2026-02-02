/**
 * County Adapter Base Class
 *
 * Abstract base class implementing common scraping utilities for all county adapters.
 * Each platform (Municode, eLaws, AmLegal) extends this class to implement
 * platform-specific scraping logic.
 *
 * Provides:
 * - Rate-limited HTTP fetching
 * - Cheerio HTML parsing
 * - Source validation
 * - Error handling
 */

import * as cheerio from 'cheerio';
import { fetchWithRateLimit } from '../../lib/scraper';
import type { CountyAdapter, CountyOrdinance, CountyPlatform } from '../types';

/**
 * Abstract base class for county ordinance adapters
 *
 * Provides common utilities for:
 * - Rate-limited HTTP fetching
 * - Cheerio HTML parsing
 * - Source validation
 * - Error handling
 */
export abstract class CountyAdapterBase implements CountyAdapter {
  /** County name */
  abstract county: string;

  /** FIPS code for county */
  abstract fipsCode: string;

  /** Base URL for ordinance source */
  abstract baseUrl: string;

  /** Platform type (affects scraping strategy) */
  abstract platform: CountyPlatform;

  /** Rate limit delay between requests (ms) */
  protected rateLimit = 500;

  /** User-Agent header for requests */
  protected userAgent = 'ComplianceIQ/1.0 (+https://compliance-iq.com)';

  /**
   * Fetch all ordinances for this county
   * Must be implemented by platform-specific adapters
   */
  abstract fetchOrdinances(): AsyncGenerator<CountyOrdinance, void, unknown>;

  /**
   * Validate that source is accessible and hasn't changed structure
   *
   * Checks:
   * 1. URL returns 200
   * 2. Expected HTML structure exists
   * 3. No Cloudflare challenge blocking access
   *
   * @returns Validation result with accessibility status
   */
  async validateSource(): Promise<{ accessible: boolean; error?: string }> {
    try {
      const response = await fetch(this.baseUrl, {
        headers: { 'User-Agent': this.userAgent },
      });

      if (!response.ok) {
        return { accessible: false, error: `HTTP ${response.status}` };
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const isValid = this.validateStructure($);
      if (!isValid) {
        return {
          accessible: false,
          error: 'HTML structure changed - expected elements not found',
        };
      }

      return { accessible: true };
    } catch (error) {
      return {
        accessible: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Validate expected HTML structure exists
   * Override in subclasses for platform-specific validation
   *
   * @param $ Cheerio API instance loaded with page HTML
   * @returns True if expected structure exists
   */
  protected abstract validateStructure($: cheerio.CheerioAPI): boolean;

  /**
   * Load and parse HTML page with Cheerio
   *
   * Includes rate limiting and retry logic for robustness.
   *
   * @param url URL to fetch
   * @returns Cheerio API instance for parsing
   */
  protected async loadPage(url: string): Promise<cheerio.CheerioAPI> {
    const response = await fetchWithRateLimit(url, `loadPage(${url})`, {
      rateLimitDelayMs: this.rateLimit,
      headers: { 'User-Agent': this.userAgent },
    });

    const html = await response.text();
    return cheerio.load(html);
  }

  /**
   * Sleep for rate limiting
   *
   * @param ms Milliseconds to sleep
   */
  protected async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper: Load Cheerio page with retry logic
 *
 * Exported for use in individual adapters that need standalone page loading
 * outside of the adapter class context.
 *
 * @param url URL to fetch
 * @param rateLimit Rate limit delay in ms (default: 500)
 * @param userAgent User-Agent header (default: ComplianceIQ/1.0)
 * @returns Cheerio API instance for parsing
 *
 * @example
 * ```ts
 * const $ = await loadCheerioPage('https://example.com/ordinances');
 * const title = $('h1').text();
 * ```
 */
export async function loadCheerioPage(
  url: string,
  rateLimit = 500,
  userAgent = 'ComplianceIQ/1.0'
): Promise<cheerio.CheerioAPI> {
  const response = await fetchWithRateLimit(url, `loadCheerioPage(${url})`, {
    rateLimitDelayMs: rateLimit,
    headers: { 'User-Agent': userAgent },
  });

  const html = await response.text();
  return cheerio.load(html);
}
