/**
 * Texas Administrative Code HTML Parser
 *
 * Parses HTML from sos.state.tx.us TAC pages using Cheerio.
 * Extracts rule headings, text, and subsection structure.
 *
 * TAC HTML Structure (as of 2026):
 * - SOS website serves TAC pages as HTML with varied structures
 * - Rule heading typically in header element or h2/h3
 * - Rule text in body content, article, or main
 * - Subsections marked with (a), (b), etc.
 * - Uses flexible selectors for structure variations
 */

import * as cheerio from 'cheerio';
import type { TACRule, TexasSubsection } from './types';

/**
 * Parse TAC HTML into structured TACRule object
 *
 * Extracts rule heading, text, and subsections from sos.state.tx.us HTML.
 * Handles multiple HTML structure variations with flexible selectors.
 *
 * @param html Raw HTML from sos.state.tx.us TAC page
 * @param title TAC title number
 * @param chapter Chapter number
 * @param section Section/rule number
 * @param sourceUrl Direct URL to source page
 * @returns Structured TACRule object
 * @throws {Error} If text is empty or too short (< 20 chars)
 *
 * @example
 * ```typescript
 * const html = await fetchTACHTML(16, '5.31');
 * const rule = parseTACHTML(html, 16, '5', '5.31', 'https://...');
 * console.log(rule.heading); // "Enforcement Actions"
 * console.log(rule.text.length); // 1234
 * ```
 */
export function parseTACHTML(
  html: string,
  title: number,
  chapter: string,
  section: string,
  sourceUrl: string
): TACRule {
  const $ = cheerio.load(html);

  // Extract heading and text
  const heading = extractTACRuleHeading($);
  const text = extractTACRuleText($);

  // Validate parsed content
  validateParsedTACRule({ heading, text });

  // Parse subsections if present
  const subsections = extractTACSubsections($, text);

  return {
    title,
    chapter,
    section,
    heading,
    text,
    subsections: subsections.length > 0 ? subsections : undefined,
    sourceUrl,
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * Extract TAC rule heading from HTML
 *
 * Tries multiple selector strategies to find the rule heading:
 * 1. Semantic selectors (.rule-heading, .tac-heading)
 * 2. Common heading elements (h1, h2, h3)
 * 3. First strong/bold text
 * 4. Fallback to section number if nothing found
 *
 * @param $ Cheerio instance loaded with TAC HTML
 * @returns Rule heading text (cleaned)
 *
 * @example
 * ```typescript
 * const $ = cheerio.load(html);
 * const heading = extractTACRuleHeading($);
 * // => "Enforcement Actions"
 * ```
 */
export function extractTACRuleHeading($: cheerio.CheerioAPI): string {
  // Try semantic selectors first
  const headingSelectors = [
    '.rule-heading',
    '.tac-heading',
    '.rule-title',
    '[class*="heading"]',
    'h1',
    'h2',
    'h3',
    'h4',
    'strong:first',
    'b:first',
  ];

  for (const selector of headingSelectors) {
    const element = $(selector).first();
    if (element.length > 0) {
      const headingText = element.text().trim();
      if (headingText.length > 0) {
        // Clean up heading (remove section number prefix if present)
        return headingText.replace(/^§?\s*[\d.]+\s*[-–—]\s*/, '').trim();
      }
    }
  }

  // Fallback: return empty string (will log warning)
  return '';
}

/**
 * Extract main rule text content from HTML
 *
 * Tries multiple selector strategies to find the rule text:
 * 1. Semantic selectors (.rule-text, .tac-body)
 * 2. Main content elements (article, main, .content)
 * 3. Body content excluding navigation/footer
 *
 * Preserves paragraph structure with double newlines.
 * Normalizes whitespace and removes navigation/footer content.
 *
 * @param $ Cheerio instance loaded with TAC HTML
 * @returns Rule text content (cleaned and normalized)
 * @throws {Error} If no text content found
 *
 * @example
 * ```typescript
 * const $ = cheerio.load(html);
 * const text = extractTACRuleText($);
 * // => "The commission may take enforcement action...\n\nPenalties include..."
 * ```
 */
export function extractTACRuleText($: cheerio.CheerioAPI): string {
  // Try semantic selectors first
  const textSelectors = [
    '.rule-text',
    '.tac-body',
    '.rule-content',
    '.tac-content',
    'article',
    'main',
    '.content',
    '#content',
    '[role="main"]',
  ];

  for (const selector of textSelectors) {
    const element = $(selector).first();
    if (element.length > 0) {
      // Remove unwanted elements
      element.find('nav, header, footer, .navigation, .breadcrumb').remove();

      // Extract text from paragraphs
      const paragraphs: string[] = [];
      element.find('p, div.paragraph, section').each((_i, elem) => {
        const text = $(elem).text().trim();
        if (text.length > 0) {
          paragraphs.push(text);
        }
      });

      if (paragraphs.length > 0) {
        return paragraphs.join('\n\n');
      }

      // Fallback: get all text content
      const text = element.text().trim();
      if (text.length > 50) { // Reasonable minimum for rule text
        return normalizeWhitespace(text);
      }
    }
  }

  // Final fallback: get body text and clean it
  const bodyText = $('body')
    .clone()
    .find('nav, header, footer, script, style, .navigation, .breadcrumb, .menu')
    .remove()
    .end()
    .text()
    .trim();

  if (bodyText.length > 0) {
    return normalizeWhitespace(bodyText);
  }

  throw new Error('No text content found in TAC HTML');
}

/**
 * Extract subsections from rule text
 *
 * Identifies subsections marked with (a), (b), (a)(1), (a)(2)(A), etc.
 * Uses regex patterns to detect subsection boundaries.
 *
 * @param $ Cheerio instance (for potential future structure-based extraction)
 * @param text Full rule text
 * @returns Array of subsections with identifiers and text
 *
 * @example
 * ```typescript
 * const subsections = extractTACSubsections($, ruleText);
 * // => [
 * //   { id: '(a)', text: 'First subsection...' },
 * //   { id: '(b)', text: 'Second subsection...' }
 * // ]
 * ```
 */
export function extractTACSubsections(
  $: cheerio.CheerioAPI,
  text: string
): TexasSubsection[] {
  const subsections: TexasSubsection[] = [];

  // Pattern for subsection markers: (a), (b), (a)(1), (a)(2)(A), etc.
  // Matches: (letter) or (letter)(number) or (letter)(number)(LETTER)
  const subsectionPattern = /\(([a-z])\)(?:\((\d+)\))?(?:\(([A-Z])\))?/g;

  // Find all subsection markers in text
  const markers: { id: string; index: number }[] = [];
  let match;

  while ((match = subsectionPattern.exec(text)) !== null) {
    const letter = match[1];
    const number = match[2];
    const capitalLetter = match[3];

    let id = `(${letter})`;
    if (number) {
      id += `(${number})`;
      if (capitalLetter) {
        id += `(${capitalLetter})`;
      }
    }

    markers.push({
      id,
      index: match.index,
    });
  }

  // Split text at subsection boundaries
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const nextMarker = markers[i + 1];

    // Get text from current marker to next marker (or end of text)
    const endIndex = nextMarker ? nextMarker.index : text.length;
    const subsectionText = text.substring(marker.index, endIndex).trim();

    // Remove the marker prefix from the text
    const textWithoutMarker = subsectionText.replace(/^\([a-z]\)(?:\(\d+\))?(?:\([A-Z]\))?\s*/, '').trim();

    if (textWithoutMarker.length > 0) {
      subsections.push({
        id: marker.id,
        text: textWithoutMarker,
      });
    }
  }

  return subsections;
}

/**
 * Validate parsed TAC rule structure
 *
 * Ensures rule has minimum required content:
 * - Text is not empty
 * - Text is at least 20 characters (reasonable minimum)
 * - Logs warning if heading is missing
 *
 * @param rule Partial rule object with text and heading
 * @throws {Error} If text is empty or too short
 */
export function validateParsedTACRule(rule: { text: string; heading: string }): void {
  if (!rule.text || rule.text.trim().length === 0) {
    throw new Error('TAC rule text is empty');
  }

  if (rule.text.trim().length < 20) {
    throw new Error(`TAC rule text too short: ${rule.text.trim().length} chars (minimum 20)`);
  }

  if (!rule.heading || rule.heading.trim().length === 0) {
    console.warn('[TX TAC Parser] Warning: Rule heading is missing');
  }
}

/**
 * Normalize whitespace in text
 *
 * - Replaces multiple spaces with single space
 * - Replaces multiple newlines with double newline (paragraph break)
 * - Trims leading/trailing whitespace
 *
 * @param text Text to normalize
 * @returns Normalized text
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ') // Multiple spaces/tabs -> single space
    .replace(/\n{3,}/g, '\n\n') // 3+ newlines -> 2 newlines
    .replace(/\n /g, '\n') // Remove space after newline
    .trim();
}
