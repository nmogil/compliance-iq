/**
 * Texas Statutes HTML Parser
 *
 * Parses HTML from capitol.texas.gov statute pages using Cheerio.
 * Extracts section headings, text, and subsection structure.
 */

import * as cheerio from 'cheerio';
import type { TexasStatuteSection, TexasSubsection } from './types';

/**
 * Extract section heading from HTML
 *
 * Tries multiple selectors to handle different HTML structures on capitol.texas.gov.
 *
 * @param $ Cheerio instance loaded with statute HTML
 * @returns Section heading text, or empty string if not found
 */
export function extractSectionHeading($: cheerio.CheerioAPI): string {
  // Try multiple heading selectors (capitol.texas.gov structure varies)
  const headingSelectors = [
    'h2.section-heading',
    'h2',
    '.statute-heading',
    'h1 + h2',
    'p.heading',
    'b', // Sometimes headings are just bold text
  ];

  for (const selector of headingSelectors) {
    const heading = $(selector).first().text().trim();
    if (heading) {
      return heading;
    }
  }

  return '';
}

/**
 * Extract main section text content from HTML
 *
 * Extracts the body text of the statute section, preserving paragraph structure
 * and removing navigation/footer content.
 *
 * @param $ Cheerio instance loaded with statute HTML
 * @returns Section text content
 */
export function extractSectionText($: cheerio.CheerioAPI): string {
  // Try multiple text container selectors
  const textSelectors = [
    '.section-text',
    '.statute-body',
    'article',
    'main',
    'body',
  ];

  let textContent = '';

  for (const selector of textSelectors) {
    const element = $(selector).first();
    if (element.length > 0) {
      // Extract text, preserving paragraphs
      textContent = element.text();
      break;
    }
  }

  // If no specific container found, get all text from body
  if (!textContent) {
    textContent = $('body').text();
  }

  // Remove common navigation/footer patterns
  textContent = textContent
    .replace(/\[Home\].*?$/gim, '') // Remove navigation
    .replace(/Copyright.*?$/gim, '') // Remove copyright footer
    .replace(/Statutes Home.*?$/gim, '') // Remove statute nav
    .trim();

  // Normalize whitespace (preserve paragraph breaks, remove excessive spaces)
  textContent = textContent.replace(/[ \t]+/g, ' '); // Multiple spaces → single space
  textContent = textContent.replace(/\n{3,}/g, '\n\n'); // Excessive newlines → double newline

  return textContent;
}

/**
 * Extract subsections from section text
 *
 * Parses subsection markers like (a), (b), (1), (2), (a)(1), (b)(2)(i)
 * and extracts text for each subsection.
 *
 * @param text Full section text content
 * @returns Array of TexasSubsection objects
 */
export function extractSubsections(text: string): TexasSubsection[] {
  const subsections: TexasSubsection[] = [];

  // Regex patterns for subsection markers
  // Matches: (a), (1), (a)(1), (b)(2)(i), etc.
  const subsectionPattern = /(\([a-z0-9]+\)(?:\([a-z0-9]+\))?(?:\([a-z0-9]+\))?)/gi;

  const matches = Array.from(text.matchAll(subsectionPattern));

  if (matches.length === 0) {
    return subsections;
  }

  // Extract text between subsection markers
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const subsectionId = match[0]; // e.g., "(a)", "(a)(1)"
    const startIndex = match.index! + subsectionId.length;

    // Find end of this subsection (start of next subsection or end of text)
    let endIndex: number;
    if (i < matches.length - 1) {
      endIndex = matches[i + 1].index!;
    } else {
      endIndex = text.length;
    }

    const subsectionText = text.substring(startIndex, endIndex).trim();

    // Only include if we have meaningful text (> 5 chars)
    if (subsectionText.length > 5) {
      subsections.push({
        id: subsectionId,
        text: subsectionText,
      });
    }
  }

  return subsections;
}

/**
 * Validate parsed statute section
 *
 * Throws error if section is invalid (empty text, too short).
 * Logs warning if heading is missing.
 *
 * @param section Parsed TexasStatuteSection object
 * @param sourceUrl URL of the statute page (for error messages)
 * @throws {Error} If section is invalid
 */
export function validateParsedSection(
  section: TexasStatuteSection,
  sourceUrl: string
): void {
  // Text must not be empty
  if (!section.text || section.text.length < 10) {
    throw new Error(
      `Invalid statute section: text too short (${section.text.length} chars) for ${sourceUrl}`
    );
  }

  // Warn if heading is missing (non-critical)
  if (!section.heading) {
    console.warn(
      `[TX Statutes] Warning: Section ${section.code} § ${section.section} has no heading (${sourceUrl})`
    );
  }
}

/**
 * Parse Texas statute HTML into structured TexasStatuteSection
 *
 * Main entry point for parsing capitol.texas.gov statute pages.
 * Extracts heading, text, and subsections from HTML.
 *
 * @param html Raw HTML from capitol.texas.gov
 * @param code Texas code abbreviation (e.g., "PE", "HS")
 * @param section Section number (e.g., "30.02")
 * @param sourceUrl Direct URL to capitol.texas.gov source
 * @returns Parsed TexasStatuteSection object
 * @throws {Error} If HTML structure doesn't match expectations or section is invalid
 *
 * @example
 * ```ts
 * const html = await fetch('https://statutes.capitol.texas.gov/Docs/PE/htm/PE.30.02.htm');
 * const section = parseStatuteHTML(
 *   await html.text(),
 *   'PE',
 *   '30.02',
 *   'https://statutes.capitol.texas.gov/Docs/PE/htm/PE.30.02.htm'
 * );
 * console.log(section.heading); // "BURGLARY"
 * console.log(section.subsections?.length); // 3
 * ```
 */
export function parseStatuteHTML(
  html: string,
  code: string,
  section: string,
  sourceUrl: string
): TexasStatuteSection {
  try {
    // Load HTML with Cheerio
    const $ = cheerio.load(html);

    // Extract components
    const heading = extractSectionHeading($);
    const text = extractSectionText($);
    const subsections = extractSubsections(text);

    // Extract chapter number from section (e.g., "30.02" → "30")
    const chapter = section.split('.')[0];

    // Build TexasStatuteSection object
    const statuteSection: TexasStatuteSection = {
      code,
      chapter,
      section,
      heading,
      text,
      subsections: subsections.length > 0 ? subsections : undefined,
      sourceUrl,
      scrapedAt: new Date().toISOString(),
    };

    // Validate before returning
    validateParsedSection(statuteSection, sourceUrl);

    return statuteSection;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Failed to parse statute HTML for ${code} § ${section}: ${error.message} (URL: ${sourceUrl})`
      );
    }
    throw error;
  }
}
