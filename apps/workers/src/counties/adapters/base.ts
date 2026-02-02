/**
 * Base County Adapter
 *
 * Abstract base class for county ordinance adapters providing common utilities:
 * - Rate-limited HTTP fetching
 * - Cheerio HTML parsing
 * - Source validation
 * - Error handling
 *
 * Each county platform (Municode, eLaws, AmLegal) extends this base
 * with platform-specific scraping logic.
 */

import * as cheerio from 'cheerio';
import { fetchWithRateLimit, retryWithBackoff } from '../../lib/scraper';
import type { CountyAdapter, CountyOrdinance, CountyPlatform } from '../types';

/**
 * Abstract base class for county ordinance adapters
 *
 * Provides common utilities shared by all platform-specific adapters.
 * Subclasses must implement:
 * - fetchOrdinances(): AsyncGenerator yielding ordinances
 * - validateStructure($): Platform-specific HTML validation
 */
export abstract class CountyAdapterBase implements CountyAdapter {
  abstract county: string;
  abstract fipsCode: string;
  abstract baseUrl: string;
  abstract platform: CountyPlatform;

  /** Rate limit delay between requests (ms) - override in subclasses as needed */
  protected rateLimit = 500;

  /** User-Agent header for requests */
  protected userAgent = 'ComplianceIQ/1.0 Legal Research (+https://compliance-iq.com)';

  /**
   * Fetch all ordinances for this county
   *
   * Yields ordinances one at a time for memory efficiency
   * when processing large county codes.
   */
  abstract fetchOrdinances(): AsyncGenerator<CountyOrdinance, void, unknown>;

  /**
   * Validate that source is accessible and hasn't changed structure
   *
   * Checks:
   * 1. URL returns 200
   * 2. Expected HTML structure exists (via validateStructure)
   * 3. No Cloudflare challenge blocking access
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
   *
   * Override in subclasses for platform-specific validation.
   * Should return true if the page contains expected elements
   * that indicate the structure hasn't changed.
   *
   * @param $ Cheerio API loaded with page HTML
   * @returns true if structure is valid
   */
  protected abstract validateStructure($: cheerio.CheerioAPI): boolean;

  /**
   * Load and parse HTML page with Cheerio
   *
   * Includes rate limiting and retry logic for resilient fetching.
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
   * Sleep utility for rate limiting
   *
   * @param ms Milliseconds to delay
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Helper: Load Cheerio page with retry logic
 *
 * Standalone function for use outside adapter classes.
 *
 * @param url URL to fetch
 * @param rateLimitMs Rate limit delay in milliseconds (default: 500)
 * @param userAgent User-Agent header (default: ComplianceIQ)
 * @returns Cheerio API instance for parsing
 */
export async function loadCheerioPage(
  url: string,
  rateLimitMs = 500,
  userAgent = 'ComplianceIQ/1.0 Legal Research (+https://compliance-iq.com)'
): Promise<cheerio.CheerioAPI> {
  const html = await retryWithBackoff(
    async () => {
      const response = await fetchWithRateLimit(url, `loadCheerioPage(${url})`, {
        rateLimitDelayMs: rateLimitMs,
        headers: { 'User-Agent': userAgent },
      });
      return response.text();
    },
    `loadCheerioPage(${url})`
  );
  return cheerio.load(html);
}
