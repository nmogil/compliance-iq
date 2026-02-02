/**
 * Municipal Markdown Parser
 *
 * Parses Firecrawl markdown output into structured municipal ordinances.
 * Uses marked library with custom renderer to extract section hierarchy.
 *
 * Key Features:
 * - Section/subsection detection from heading structure
 * - Lettered list detection (a), (b), (c) for subsections
 * - Flexible heading patterns for Municode and American Legal
 * - Validation with warnings for structure issues
 *
 * @example
 * ```typescript
 * const ordinances = parseMarkdownToOrdinances(markdown, cityConfig);
 * console.log(`Parsed ${ordinances.length} ordinances`);
 * ```
 */

import { marked, type Token, type Tokens } from 'marked';
import type { MunicipalCityConfig, MunicipalOrdinance } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Extracted section from markdown (internal parsing state)
 */
interface ExtractedSection {
  chapter: string;
  section: string;
  heading: string;
  text: string;
  subsections: Array<{ id: string; text: string }>;
}

/**
 * Validation result for parsed ordinances
 */
export interface ValidationResult {
  /** Ordinances that passed validation */
  valid: MunicipalOrdinance[];
  /** Warnings about potential issues */
  warnings: string[];
}

// ============================================================================
// Markdown Parsing
// ============================================================================

/**
 * Parse Firecrawl markdown into structured ordinances
 *
 * Uses marked's lexer to tokenize markdown and extract sections
 * based on heading hierarchy and content patterns.
 *
 * @param markdown Raw markdown from Firecrawl
 * @param city City configuration for context
 * @returns Array of parsed ordinances
 *
 * @example
 * ```typescript
 * const ordinances = parseMarkdownToOrdinances(markdown, houston);
 * // Returns MunicipalOrdinance[] with chapter, section, heading, text, subsections
 * ```
 */
export function parseMarkdownToOrdinances(
  markdown: string,
  city: MunicipalCityConfig
): MunicipalOrdinance[] {
  const tokens = marked.lexer(markdown);
  const sections = extractSectionsFromTokens(tokens);

  // Convert extracted sections to MunicipalOrdinance
  const now = new Date();

  return sections.map((section) => ({
    cityId: city.cityId,
    chapter: section.chapter,
    section: section.section,
    heading: section.heading,
    text: section.text,
    subsections: section.subsections,
    sourceUrl: city.baseUrl,
    scrapedAt: now,
  }));
}

/**
 * Extract section strings from markdown
 *
 * Simple extraction for inspection/debugging without full parsing.
 *
 * @param markdown Raw markdown content
 * @returns Array of section identifiers found
 *
 * @example
 * ```typescript
 * const sections = extractSections(markdown);
 * // Returns ['1-1', '1-2', '2-1', ...]
 * ```
 */
export function extractSections(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  const sections = extractSectionsFromTokens(tokens);
  return sections.map((s) => s.section);
}

/**
 * Extract sections from marked tokens
 *
 * Internal function that processes markdown tokens and builds
 * section hierarchy using heading detection.
 */
function extractSectionsFromTokens(tokens: Token[]): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  let currentChapter = '1';
  let currentSection: ExtractedSection | null = null;
  let pendingText: string[] = [];

  for (const token of tokens) {
    if (token.type === 'heading') {
      const headingToken = token as Tokens.Heading;
      const { text, depth } = headingToken;

      // Chapter detection (level 1-2)
      const chapterMatch = text.match(/Chapter\s+([\d.]+)/i);
      if (chapterMatch && depth <= 2) {
        // Finalize any current section before changing chapter
        if (currentSection) {
          currentSection.text = pendingText.join('\n\n').trim();
          detectSubsections(currentSection);
          sections.push(currentSection);
          currentSection = null;
          pendingText = [];
        }
        currentChapter = chapterMatch[1]!;
        continue;
      }

      // Section detection (level 2-4)
      // Match patterns like:
      //   "Section 1-2. Definitions"
      //   "Sec. 1.02 - Definitions"
      //   "1.03. Purpose"
      const sectionMatch = text.match(
        /(?:Sec(?:tion)?\.?\s*)?([\d.-]+)[.:\s-]+\s*(.+)/i
      );
      if (sectionMatch && depth >= 2 && depth <= 4) {
        // Finalize previous section
        if (currentSection) {
          currentSection.text = pendingText.join('\n\n').trim();
          detectSubsections(currentSection);
          sections.push(currentSection);
        }

        // Start new section
        currentSection = {
          chapter: currentChapter,
          section: sectionMatch[1]!,
          heading: sectionMatch[2]!.trim(),
          text: '',
          subsections: [],
        };
        pendingText = [];
        continue;
      }

      // Article or Part heading (level 1-2) - treat as chapter boundary
      const articleMatch = text.match(/(?:Article|Part)\s+([\dIVXLCDM]+)/i);
      if (articleMatch && depth <= 2) {
        if (currentSection) {
          currentSection.text = pendingText.join('\n\n').trim();
          detectSubsections(currentSection);
          sections.push(currentSection);
          currentSection = null;
          pendingText = [];
        }
        // Use article/part as chapter prefix
        currentChapter = articleMatch[1]!;
        continue;
      }
    }

    // Collect content for current section
    if (currentSection) {
      const textContent = extractTextFromToken(token);
      if (textContent) {
        pendingText.push(textContent);
      }
    }
  }

  // Finalize last section
  if (currentSection) {
    currentSection.text = pendingText.join('\n\n').trim();
    detectSubsections(currentSection);
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extract text content from a marked token
 */
function extractTextFromToken(token: Token): string {
  switch (token.type) {
    case 'paragraph':
      return (token as Tokens.Paragraph).text;
    case 'text':
      return (token as Tokens.Text).text;
    case 'list': {
      const listToken = token as Tokens.List;
      return listToken.items
        .map((item: Tokens.ListItem) => {
          return `- ${item.text}`;
        })
        .join('\n');
    }
    case 'blockquote':
      return `> ${(token as Tokens.Blockquote).text}`;
    case 'code':
      return (token as Tokens.Code).text;
    case 'space':
      return '';
    default:
      // For other token types, try to extract raw text
      if ('text' in token && typeof token.text === 'string') {
        return token.text;
      }
      return '';
  }
}

/**
 * Detect and extract subsections from section text
 *
 * Looks for lettered/numbered lists:
 *   (a) First subsection
 *   (b) Second subsection
 *   (1) Numbered subsection
 *
 * Modifies the section in place by populating subsections array.
 */
function detectSubsections(section: ExtractedSection): void {
  const text = section.text;

  // Match subsection patterns: (a), (b), (1), (i), etc.
  const subsectionRegex = /\(([a-z]|\d+|[ivxlcdm]+)\)\s+([^(]+?)(?=\([a-z\d]|\s*$)/gi;
  const matches = Array.from(text.matchAll(subsectionRegex));

  if (matches.length > 0) {
    for (const match of matches) {
      section.subsections.push({
        id: `(${match[1]})`,
        text: match[2]!.trim(),
      });
    }
  }

  // Alternative: try matching lettered items at start of lines
  if (section.subsections.length === 0) {
    const lineSubsectionRegex = /^\s*\(([a-z]|\d+)\)\s+(.+)$/gim;
    const lineMatches = Array.from(text.matchAll(lineSubsectionRegex));

    for (const match of lineMatches) {
      section.subsections.push({
        id: `(${match[1]})`,
        text: match[2]!.trim(),
      });
    }
  }
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate parsed ordinances
 *
 * Checks for common parsing issues and returns valid ordinances
 * with warnings about potential problems.
 *
 * @param ordinances Parsed ordinances to validate
 * @param city City configuration for context
 * @returns Validation result with valid ordinances and warnings
 *
 * @example
 * ```typescript
 * const { valid, warnings } = validateOrdinances(ordinances, houston);
 * console.log(`${valid.length} valid, ${warnings.length} warnings`);
 * ```
 */
export function validateOrdinances(
  ordinances: MunicipalOrdinance[],
  city: MunicipalCityConfig
): ValidationResult {
  const valid: MunicipalOrdinance[] = [];
  const warnings: string[] = [];

  for (const ordinance of ordinances) {
    const issues: string[] = [];

    // Check for empty section
    if (!ordinance.section || ordinance.section.trim() === '') {
      issues.push('Empty section identifier');
    }

    // Check for empty text
    if (!ordinance.text || ordinance.text.trim().length < 10) {
      issues.push(`Very short or empty text (${ordinance.text?.length || 0} chars)`);
    }

    // Check for empty heading
    if (!ordinance.heading || ordinance.heading.trim() === '') {
      issues.push('Empty heading');
    }

    // Check for suspiciously long section numbers (may be parsing error)
    if (ordinance.section && ordinance.section.length > 20) {
      issues.push(`Unusually long section identifier: ${ordinance.section}`);
    }

    if (issues.length > 0) {
      warnings.push(
        `[${city.name}] Section ${ordinance.section}: ${issues.join(', ')}`
      );
      // Still include in valid if it has minimum required fields
      if (ordinance.section && ordinance.text && ordinance.text.length >= 10) {
        valid.push(ordinance);
      }
    } else {
      valid.push(ordinance);
    }
  }

  // Add overall warnings
  if (ordinances.length === 0) {
    warnings.push(`[${city.name}] No ordinances parsed from markdown`);
  } else if (valid.length === 0) {
    warnings.push(`[${city.name}] All ${ordinances.length} ordinances failed validation`);
  } else if (valid.length < ordinances.length * 0.5) {
    warnings.push(
      `[${city.name}] Only ${valid.length}/${ordinances.length} ordinances passed validation`
    );
  }

  return { valid, warnings };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Count sections in markdown without full parsing
 *
 * Quick scan for section patterns - useful for validation.
 *
 * @param markdown Raw markdown
 * @returns Estimated section count
 */
export function countSectionsInMarkdown(markdown: string): number {
  // Count heading patterns that look like section identifiers
  const sectionPattern = /^#{2,4}\s+(?:Sec(?:tion)?\.?\s*)?([\d.-]+)[.:\s-]/gim;
  const matches = Array.from(markdown.matchAll(sectionPattern));
  return matches.length;
}

/**
 * Get chapter list from markdown
 *
 * Quick extraction of chapter identifiers.
 *
 * @param markdown Raw markdown
 * @returns Array of chapter identifiers
 */
export function extractChaptersFromMarkdown(markdown: string): string[] {
  const chapterPattern = /^#{1,2}\s+Chapter\s+([\d.]+)/gim;
  const matches = Array.from(markdown.matchAll(chapterPattern));
  return matches.map((m) => m[1]!);
}

/**
 * Clean up markdown text
 *
 * Removes excessive whitespace, normalizes line breaks.
 *
 * @param text Raw markdown text
 * @returns Cleaned text
 */
export function cleanMarkdownText(text: string): string {
  return text
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\n{3,}/g, '\n\n') // Remove excessive blank lines
    .replace(/[ \t]+\n/g, '\n') // Remove trailing whitespace
    .replace(/\n[ \t]+/g, '\n') // Remove leading whitespace on lines
    .trim();
}
