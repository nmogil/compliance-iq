/**
 * Texas Statutes Fetcher
 *
 * Fetches statute HTML from capitol.texas.gov with rate limiting
 * and retry logic. Implements chapter/section discovery.
 */

import { fetchWithRateLimit, NotFoundError } from '../lib/scraper';
import { generateStatuteUrl } from '../lib/citations';
import { parseStatuteHTML } from './parse-statutes';
import type { TexasStatuteSection, TexasCodeConfig } from './types';
import * as cheerio from 'cheerio';

/**
 * Fetch raw HTML for a Texas statute section
 *
 * @param code Texas code abbreviation (e.g., "PE", "HS")
 * @param section Section number (e.g., "30.02")
 * @returns Raw HTML text from capitol.texas.gov
 * @throws {NotFoundError} If section doesn't exist (404)
 * @throws {ScrapingError} On other HTTP errors
 */
export async function fetchStatuteHTML(
  code: string,
  section: string
): Promise<string> {
  const url = generateStatuteUrl(code, section);

  const response = await fetchWithRateLimit(
    url,
    `Fetch ${code} § ${section}`,
    { rateLimitDelayMs: 200 } // Conservative 200ms delay
  );

  return response.text();
}

/**
 * Fetch and parse a Texas statute section
 *
 * Main entry point for fetching individual statute sections.
 * Handles fetching, parsing, and logging.
 *
 * @param code Texas code abbreviation (e.g., "PE", "HS")
 * @param section Section number (e.g., "30.02")
 * @returns Parsed TexasStatuteSection object
 * @throws {NotFoundError} If section doesn't exist (404)
 * @throws {ScrapingError} On HTTP errors
 * @throws {Error} On parsing errors
 *
 * @example
 * ```ts
 * const section = await fetchTexasStatute('PE', '30.02');
 * console.log(section.heading); // "BURGLARY"
 * console.log(section.text.length); // ~1500 chars
 * ```
 */
export async function fetchTexasStatute(
  code: string,
  section: string
): Promise<TexasStatuteSection> {
  const url = generateStatuteUrl(code, section);

  // Fetch HTML
  const html = await fetchStatuteHTML(code, section);

  // Parse HTML
  const statuteSection = parseStatuteHTML(html, code, section, url);

  console.log(`[TX Statutes] Fetched ${code} § ${section}`);

  return statuteSection;
}

/**
 * Discover all chapter numbers for a Texas code
 *
 * Fetches the code's table of contents from capitol.texas.gov
 * and extracts chapter numbers.
 *
 * @param code Texas code abbreviation (e.g., "PE", "HS")
 * @returns Array of chapter numbers (e.g., ["1", "2", "30", "481"])
 * @throws {ScrapingError} On HTTP or parsing errors
 *
 * @example
 * ```ts
 * const chapters = await discoverCodeChapters('PE');
 * console.log(chapters); // ["1", "2", "3", "5", "6", "7", "8", "9", "12", ...]
 * ```
 */
export async function discoverCodeChapters(code: string): Promise<string[]> {
  // Table of contents URL pattern
  const tocUrl = `https://statutes.capitol.texas.gov/Docs/${code}/htm/${code}.toc.htm`;

  console.log(`[TX Statutes] Discovering chapters for ${code}...`);

  const response = await fetchWithRateLimit(
    tocUrl,
    `Fetch ${code} table of contents`,
    { rateLimitDelayMs: 200 }
  );

  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract chapter links
  // Capitol.texas.gov TOC structure: links to chapter pages
  // Example: <a href="PE.1.htm">CHAPTER 1. GENERAL PROVISIONS</a>
  const chapters: string[] = [];
  const chapterLinkPattern = new RegExp(`${code}\\.(\\d+)\\.htm`, 'gi');

  $('a').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      const match = chapterLinkPattern.exec(href);
      if (match) {
        const chapterNumber = match[1];
        if (!chapters.includes(chapterNumber)) {
          chapters.push(chapterNumber);
        }
      }
      // Reset regex lastIndex for next iteration
      chapterLinkPattern.lastIndex = 0;
    }
  });

  // Sort chapters numerically
  chapters.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  console.log(`[TX Statutes] Found ${chapters.length} chapters in ${code}`);

  return chapters;
}

/**
 * Discover all section numbers within a Texas code chapter
 *
 * Fetches the chapter page from capitol.texas.gov and extracts section numbers.
 *
 * @param code Texas code abbreviation (e.g., "PE", "HS")
 * @param chapter Chapter number (e.g., "30", "481")
 * @returns Array of section numbers (e.g., ["30.01", "30.02", "30.03"])
 * @throws {ScrapingError} On HTTP or parsing errors
 *
 * @example
 * ```ts
 * const sections = await discoverChapterSections('PE', '30');
 * console.log(sections); // ["30.01", "30.02", "30.03", "30.04", "30.05", "30.06", "30.07"]
 * ```
 */
export async function discoverChapterSections(
  code: string,
  chapter: string
): Promise<string[]> {
  // Chapter page URL pattern
  const chapterUrl = `https://statutes.capitol.texas.gov/Docs/${code}/htm/${code}.${chapter}.htm`;

  const response = await fetchWithRateLimit(
    chapterUrl,
    `Fetch ${code} Chapter ${chapter}`,
    { rateLimitDelayMs: 200 }
  );

  const html = await response.text();
  const $ = cheerio.load(html);

  // Extract section links
  // Capitol.texas.gov chapter structure: links to individual sections
  // Example: <a href="PE.30.02.htm">Sec. 30.02. BURGLARY</a>
  const sections: string[] = [];
  const sectionLinkPattern = new RegExp(
    `${code}\\.(${chapter}\\.\\d+)\\.htm`,
    'gi'
  );

  $('a').each((_, element) => {
    const href = $(element).attr('href');
    if (href) {
      const match = sectionLinkPattern.exec(href);
      if (match) {
        const sectionNumber = match[1];
        if (!sections.includes(sectionNumber)) {
          sections.push(sectionNumber);
        }
      }
      // Reset regex lastIndex for next iteration
      sectionLinkPattern.lastIndex = 0;
    }
  });

  // Sort sections numerically (parse decimal numbers correctly)
  sections.sort((a, b) => {
    const aParts = a.split('.').map(n => parseInt(n, 10));
    const bParts = b.split('.').map(n => parseInt(n, 10));

    // Compare chapter numbers
    if (aParts[0] !== bParts[0]) {
      return aParts[0] - bParts[0];
    }

    // Compare section numbers
    return aParts[1] - bParts[1];
  });

  return sections;
}

/**
 * Fetch all statutes for a Texas code
 *
 * AsyncGenerator that discovers chapters and sections, then yields
 * each parsed statute section as it's fetched. Memory-efficient for
 * large codes with hundreds of sections.
 *
 * Gracefully handles missing sections (404) by logging and continuing.
 *
 * @param codeConfig Texas code configuration object
 * @yields Parsed TexasStatuteSection objects
 * @throws {ScrapingError} On unrecoverable HTTP errors
 * @throws {Error} On discovery or parsing errors
 *
 * @example
 * ```ts
 * const peConfig = {
 *   abbreviation: 'PE',
 *   name: 'Penal Code',
 *   categories: ['criminal'],
 *   enabled: true
 * };
 *
 * for await (const section of fetchTexasCode(peConfig)) {
 *   console.log(`${section.code} § ${section.section}: ${section.heading}`);
 *   // Store in database, embed, etc.
 * }
 * ```
 */
export async function* fetchTexasCode(
  codeConfig: TexasCodeConfig
): AsyncGenerator<TexasStatuteSection> {
  console.log(
    `[TX Statutes] Fetching code: ${codeConfig.abbreviation} (${codeConfig.name})`
  );

  // Discover all chapters for the code
  const chapters = await discoverCodeChapters(codeConfig.abbreviation);
  console.log(
    `[TX Statutes] Found ${chapters.length} chapters in ${codeConfig.abbreviation}`
  );

  // Process each chapter
  for (const chapter of chapters) {
    console.log(
      `[TX Statutes] Processing ${codeConfig.abbreviation} Chapter ${chapter}...`
    );

    // Discover sections in this chapter
    const sections = await discoverChapterSections(
      codeConfig.abbreviation,
      chapter
    );
    console.log(
      `[TX Statutes] Found ${sections.length} sections in Chapter ${chapter}`
    );

    // Fetch each section
    for (const section of sections) {
      try {
        const statuteSection = await fetchTexasStatute(
          codeConfig.abbreviation,
          section
        );
        yield statuteSection;
      } catch (error) {
        if (error instanceof NotFoundError) {
          console.warn(
            `[TX Statutes] Section not found: ${codeConfig.abbreviation} § ${section}`
          );
          continue; // Skip 404s, continue to next section
        }
        throw error; // Rethrow other errors
      }
    }
  }

  console.log(
    `[TX Statutes] Completed fetching code: ${codeConfig.abbreviation}`
  );
}
