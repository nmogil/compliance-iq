/**
 * Shared scraper utilities for rate-limited HTTP requests with exponential backoff.
 *
 * Texas government websites (capitol.texas.gov, sos.state.tx.us) require careful rate limiting
 * to avoid 429 errors. These utilities provide:
 * - Exponential backoff with jitter
 * - Retry-After header parsing
 * - Per-domain rate limiting
 * - Custom error types for scraping operations
 *
 * @example
 * ```typescript
 * const response = await fetchWithRateLimit(
 *   'https://capitol.texas.gov/statutes/docs/PE.htm',
 *   'Fetch Texas Penal Code index'
 * );
 * const html = await response.text();
 * ```
 */

/**
 * Error thrown when a resource is not found (404).
 * This error is not retried by retryWithBackoff.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when a rate limit is encountered (429).
 * Includes optional Retry-After value in seconds.
 */
export class RateLimitError extends Error {
  retryAfter?: number; // seconds
  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * General scraping error with optional HTTP status code.
 */
export class ScrapingError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ScrapingError';
    this.statusCode = statusCode;
  }
}

/**
 * Configuration for retry behavior with exponential backoff.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds for first retry (default: 1000) */
  baseDelay: number;
  /** Maximum delay in milliseconds (default: 8000) */
  maxDelay: number;
  /** Add randomness to prevent thundering herd (default: true) */
  jitter: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 8000,
  jitter: true,
};

/**
 * Async sleep utility.
 *
 * @param ms - Milliseconds to delay
 * @returns Promise that resolves after the delay
 *
 * @example
 * ```typescript
 * await delay(1000); // Wait 1 second
 * ```
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with optional jitter.
 *
 * Delays: 1s, 2s, 4s, 8s (capped at maxDelay)
 * Jitter adds 0-25% randomness to prevent thundering herd.
 *
 * @param attempt - Current attempt number (0-indexed)
 * @param config - Retry configuration
 * @returns Delay in milliseconds
 */
function calculateDelay(attempt: number, config: RetryConfig): number {
  // Exponential: 1s, 2s, 4s, 8s...
  let delayMs = config.baseDelay * Math.pow(2, attempt);

  // Cap at maxDelay
  delayMs = Math.min(delayMs, config.maxDelay);

  // Add jitter (0-25% of delay) to prevent thundering herd
  if (config.jitter) {
    const jitterMs = Math.random() * delayMs * 0.25;
    delayMs += jitterMs;
  }

  return Math.floor(delayMs);
}

/**
 * Parse Retry-After header from HTTP response.
 *
 * Supports both delay-seconds and HTTP-date formats per RFC 7231.
 *
 * @param response - HTTP response with potential Retry-After header
 * @returns Delay in milliseconds, or null if header missing/invalid
 */
function extractRetryAfter(response: Response): number | null {
  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return null;

  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000; // Convert to ms
  }

  // Try parsing as HTTP date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const delayMs = date.getTime() - Date.now();
    return Math.max(0, delayMs);
  }

  return null;
}

/**
 * Retry an async operation with exponential backoff.
 *
 * Automatically retries transient failures with exponential backoff.
 * Does NOT retry NotFoundError (404s are permanent).
 * Respects Retry-After headers from RateLimitError.
 *
 * @param fn - Async function to retry
 * @param operationName - Human-readable operation name for logging
 * @param config - Optional retry configuration overrides
 * @returns Result of the operation
 * @throws {NotFoundError} Immediately on 404 (not retried)
 * @throws {Error} After maxRetries exceeded
 *
 * @example
 * ```typescript
 * const data = await retryWithBackoff(
 *   async () => {
 *     const response = await fetch('https://api.example.com/data');
 *     if (!response.ok) throw new Error('Request failed');
 *     return response.json();
 *   },
 *   'Fetch API data',
 *   { maxRetries: 5 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  operationName: string,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const fullConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= fullConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on 404 (resource doesn't exist)
      if (error instanceof NotFoundError) {
        throw error;
      }

      // Check if we've exhausted retries
      if (attempt >= fullConfig.maxRetries) {
        console.error(`[Scraper] ${operationName} failed after ${attempt + 1} attempts: ${lastError.message}`);
        throw lastError;
      }

      // Calculate delay (use Retry-After if available)
      let delayMs: number;
      if (error instanceof RateLimitError && error.retryAfter) {
        delayMs = error.retryAfter * 1000;
        console.log(`[Scraper] Rate limited, using Retry-After: ${delayMs}ms`);
      } else {
        delayMs = calculateDelay(attempt, fullConfig);
      }

      console.log(`[Scraper] ${operationName} failed (attempt ${attempt + 1}/${fullConfig.maxRetries + 1}), retrying in ${delayMs}ms`);
      await delay(delayMs);
    }
  }

  throw lastError ?? new Error('Retry failed with unknown error');
}

/**
 * Options for fetchWithRateLimit.
 */
export interface FetchOptions {
  /** Minimum delay between requests to same domain in milliseconds (default: 200) */
  rateLimitDelayMs?: number;
  /** Additional HTTP headers to include */
  headers?: Record<string, string>;
  /** Retry configuration overrides */
  retryConfig?: Partial<RetryConfig>;
}

// Track last request time per domain for rate limiting
const lastRequestTime: Record<string, number> = {};

/**
 * Fetch a URL with automatic rate limiting and retry logic.
 *
 * Features:
 * - Per-domain rate limiting (default: 200ms between requests)
 * - Exponential backoff retry on transient failures
 * - Retry-After header support
 * - User-Agent header for polite scraping
 * - Automatic error handling for 404, 429, other HTTP errors
 *
 * @param url - URL to fetch
 * @param operationName - Human-readable operation name for logging
 * @param options - Fetch options (rate limit delay, headers, retry config)
 * @returns HTTP response
 * @throws {NotFoundError} On 404
 * @throws {RateLimitError} On 429 after retries exhausted
 * @throws {ScrapingError} On other HTTP errors after retries exhausted
 *
 * @example
 * ```typescript
 * // Fetch with default 200ms rate limit
 * const response = await fetchWithRateLimit(
 *   'https://capitol.texas.gov/statutes/docs/PE.htm',
 *   'Fetch Penal Code index'
 * );
 *
 * // Fetch with custom rate limit and retry config
 * const response = await fetchWithRateLimit(
 *   'https://sos.state.tx.us/tac/index.shtml',
 *   'Fetch TAC index',
 *   {
 *     rateLimitDelayMs: 500,
 *     retryConfig: { maxRetries: 5 }
 *   }
 * );
 * ```
 */
export async function fetchWithRateLimit(
  url: string,
  operationName: string,
  options: FetchOptions = {}
): Promise<Response> {
  const { rateLimitDelayMs = 200, headers = {}, retryConfig = {} } = options;

  // Extract domain for rate limiting
  const domain = new URL(url).hostname;

  // Enforce minimum delay between requests to same domain
  const now = Date.now();
  const lastTime = lastRequestTime[domain] || 0;
  const elapsed = now - lastTime;

  if (elapsed < rateLimitDelayMs) {
    await delay(rateLimitDelayMs - elapsed);
  }

  // Update last request time
  lastRequestTime[domain] = Date.now();

  // Make request with retry
  return retryWithBackoff(
    async () => {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ComplianceIQ-Bot/1.0 (Legal research tool; +https://compliance-iq.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...headers,
        },
      });

      // Handle specific status codes
      if (response.status === 404) {
        throw new NotFoundError(`Resource not found: ${url}`);
      }

      if (response.status === 429) {
        const retryAfterMs = extractRetryAfter(response);
        throw new RateLimitError(
          `Rate limited: ${url}`,
          retryAfterMs ? retryAfterMs / 1000 : undefined
        );
      }

      if (!response.ok) {
        throw new ScrapingError(
          `HTTP ${response.status}: ${response.statusText} for ${url}`,
          response.status
        );
      }

      return response;
    },
    operationName,
    retryConfig
  );
}
