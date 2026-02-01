/**
 * Texas Administrative Code Fetcher
 *
 * Fetches TAC HTML from sos.state.tx.us with rate limiting
 * and retry logic. Implements title/chapter/rule discovery.
 *
 * Features:
 * - Rate-limited requests (200ms delay)
 * - Exponential backoff retry
 * - Title/chapter/rule discovery
 * - AsyncGenerator for memory-efficient streaming
 * - Graceful handling of missing rules
 */

import { fetchWithRateLimit, NotFoundError } from '../lib/scraper';
import { generateTACUrl } from '../lib/citations';
import { parseTACHTML } from './parse-tac';
import type { TACRule, TACTitleConfig } from './types';
import * as cheerio from 'cheerio';

/**
 * Fetch TAC HTML for a specific rule
 *
 * @param title TAC title number
 * @param chapter Chapter number
 * @param section Section/rule number
 * @returns Raw HTML content
 * @throws {NotFoundError} If rule not found (404)
 * @throws {ScrapingError} On other HTTP errors after retries
 *
 * @example
 * ```typescript
 * const html = await fetchTACHTML(16, '5', '5.31');
 * ```
 */
export async function fetchTACHTML(
  title: number,
  chapter: string,
  section: string
): Promise<string> {
  const url = generateTACUrl(title, chapter, section);

  const response = await fetchWithRateLimit(
    url,
    `Fetch TAC ${title} § ${section}`,
    { rateLimitDelayMs: 200 }
  );

  return response.text();
}

/**
 * Fetch and parse a TAC rule
 *
 * Combines fetching and parsing into a single operation.
 * Returns structured TACRule object ready for chunking.
 *
 * @param title TAC title number
 * @param chapter Chapter number
 * @param section Section/rule number
 * @returns Structured TACRule object
 * @throws {NotFoundError} If rule not found
 *
 * @example
 * ```typescript
 * const rule = await fetchTACRule(16, '5', '5.31');
 * console.log(rule.heading); // "Enforcement Actions"
 * console.log(rule.text.length); // 1234
 * ```
 */
export async function fetchTACRule(
  title: number,
  chapter: string,
  section: string
): Promise<TACRule> {
  const html = await fetchTACHTML(title, chapter, section);
  const sourceUrl = generateTACUrl(title, chapter, section);

  const rule = parseTACHTML(html, title, chapter, section, sourceUrl);

  console.log(`[TX TAC] Fetched Title ${title} § ${section}`);

  return rule;
}

/**
 * Discover all chapters in a TAC title
 *
 * Fetches the title's table of contents and extracts chapter numbers.
 * Uses sos.state.tx.us title listing page.
 *
 * @param title TAC title number
 * @returns Array of chapter identifiers (e.g., ["1", "2", "3"])
 *
 * @example
 * ```typescript
 * const chapters = await discoverTACChapters(16);
 * console.log(chapters); // ["1", "2", "3", "5", ...]
 * ```
 */
export async function discoverTACChapters(title: number): Promise<string[]> {
  // TAC title TOC URL pattern
  const url = `https://texreg.sos.state.tx.us/public/readtac$ext.ViewTAC?tac_view=3&ti=${title}`;

  const response = await fetchWithRateLimit(
    url,
    `Discover TAC Title ${title} chapters`,
    { rateLimitDelayMs: 200 }
  );

  const html = await response.text();
  const $ = cheerio.load(html);

  const chapters: Set<string> = new Set();

  // Strategy 1: Look for links to chapter pages
  // Pattern: href containing ch= parameter
  $('a[href*="ch="]').each((_i, elem) => {
    const href = $(elem).attr('href');
    if (href) {
      const match = href.match(/[?&]ch=(\d+)/);
      if (match && match[1]) {
        chapters.add(match[1]);
      }
    }
  });

  // Strategy 2: Look for "Chapter X" text patterns
  $('td, li, div').each((_i, elem) => {
    const text = $(elem).text();
    const match = text.match(/Chapter\s+(\d+)/i);
    if (match && match[1]) {
      chapters.add(match[1]);
    }
  });

  const chapterList = Array.from(chapters).sort((a, b) => {
    return parseInt(a, 10) - parseInt(b, 10);
  });

  console.log(`[TX TAC] Found ${chapterList.length} chapters in Title ${title}`);

  return chapterList;
}

/**
 * Discover all rules/sections in a TAC chapter
 *
 * Fetches the chapter's table of contents and extracts rule numbers.
 * Rules are typically in format: "5.1", "5.31", "289.1", etc.
 *
 * @param title TAC title number
 * @param chapter Chapter number
 * @returns Array of section identifiers (e.g., ["5.1", "5.31", "5.41"])
 *
 * @example
 * ```typescript
 * const rules = await discoverChapterRules(16, '5');
 * console.log(rules); // ["5.1", "5.11", "5.31", ...]
 * ```
 */
export async function discoverChapterRules(
  title: number,
  chapter: string
): Promise<string[]> {
  // TAC chapter TOC URL pattern
  const url = `https://texreg.sos.state.tx.us/public/readtac$ext.ViewTAC?tac_view=4&ti=${title}&ch=${chapter}`;

  const response = await fetchWithRateLimit(
    url,
    `Discover TAC Title ${title} Chapter ${chapter} rules`,
    { rateLimitDelayMs: 200 }
  );

  const html = await response.text();
  const $ = cheerio.load(html);

  const rules: Set<string> = new Set();

  // Strategy 1: Look for links to rule pages
  // Pattern: href containing rl= parameter
  $('a[href*="rl="]').each((_i, elem) => {
    const href = $(elem).attr('href');
    if (href) {
      const match = href.match(/[?&]rl=([\d.]+)/);
      if (match && match[1]) {
        rules.add(match[1]);
      }
    }
  });

  // Strategy 2: Look for section number patterns in text
  // Pattern: §X.Y or "Section X.Y"
  $('td, li, div').each((_i, elem) => {
    const text = $(elem).text();

    // Match § followed by number.number
    const match1 = text.match(/§\s*([\d.]+)/);
    if (match1 && match1[1]) {
      // Verify it starts with chapter number
      if (match1[1].startsWith(`${chapter}.`)) {
        rules.add(match1[1]);
      }
    }

    // Match "Section X.Y" pattern
    const match2 = text.match(/Section\s+([\d.]+)/i);
    if (match2 && match2[1]) {
      if (match2[1].startsWith(`${chapter}.`)) {
        rules.add(match2[1]);
      }
    }
  });

  const ruleList = Array.from(rules).sort((a, b) => {
    // Sort numerically by full section number
    const aNum = parseFloat(a);
    const bNum = parseFloat(b);
    return aNum - bNum;
  });

  console.log(`[TX TAC] Found ${ruleList.length} rules in Title ${title} Chapter ${chapter}`);

  return ruleList;
}

/**
 * Fetch all rules in a TAC title
 *
 * Discovers chapters and rules, then yields each rule as fetched.
 * Uses AsyncGenerator for memory-efficient streaming.
 *
 * Features:
 * - Memory-efficient: yields rules one at a time
 * - Graceful error handling: skips NotFoundError rules
 * - Progress logging for each chapter and rule
 *
 * @param titleConfig TAC title configuration
 * @yields TACRule objects as fetched
 *
 * @example
 * ```typescript
 * const titleConfig = {
 *   number: 16,
 *   name: 'Economic Regulation',
 *   categories: ['alcohol', 'licensing'],
 *   enabled: true
 * };
 *
 * for await (const rule of fetchTACTitle(titleConfig)) {
 *   console.log(`Fetched: ${rule.section}`);
 *   // Process rule (chunk, embed, etc.)
 * }
 * ```
 */
export async function* fetchTACTitle(
  titleConfig: TACTitleConfig
): AsyncGenerator<TACRule> {
  console.log(`[TX TAC] Fetching title: ${titleConfig.number} (${titleConfig.name})`);

  try {
    const chapters = await discoverTACChapters(titleConfig.number);

    if (chapters.length === 0) {
      console.warn(`[TX TAC] No chapters found for Title ${titleConfig.number}`);
      return;
    }

    console.log(`[TX TAC] Processing ${chapters.length} chapters in Title ${titleConfig.number}`);

    for (const chapter of chapters) {
      console.log(`[TX TAC] Processing Title ${titleConfig.number} Chapter ${chapter}`);

      try {
        const rules = await discoverChapterRules(titleConfig.number, chapter);

        if (rules.length === 0) {
          console.warn(`[TX TAC] No rules found in Title ${titleConfig.number} Chapter ${chapter}`);
          continue;
        }

        for (const rule of rules) {
          try {
            const tacRule = await fetchTACRule(titleConfig.number, chapter, rule);
            yield tacRule;
          } catch (error) {
            if (error instanceof NotFoundError) {
              console.warn(`[TX TAC] Rule not found: Title ${titleConfig.number} § ${rule}`);
              continue;
            }
            // Re-throw other errors
            throw error;
          }
        }
      } catch (error) {
        console.error(`[TX TAC] Failed to process Chapter ${chapter}:`, error);
        // Continue with next chapter
        continue;
      }
    }

    console.log(`[TX TAC] Completed Title ${titleConfig.number}`);
  } catch (error) {
    console.error(`[TX TAC] Failed to fetch Title ${titleConfig.number}:`, error);
    throw error;
  }
}
