/**
 * Bluebook Citation Utilities
 *
 * Generates standard legal citations and URLs for CFR references
 * following The Bluebook citation format.
 */

/**
 * Generate Bluebook-format CFR citation
 *
 * Format: [Title] C.F.R. § [Section][(Subsection)]
 *
 * @param title CFR title number (1-50)
 * @param section Section number (e.g., "117.3")
 * @param subsection Optional subsection identifier (e.g., "(a)(1)")
 * @returns Bluebook citation string
 *
 * @example
 * ```ts
 * generateCFRCitation(21, '117.3')
 * // => "21 C.F.R. § 117.3"
 *
 * generateCFRCitation(21, '117.3', '(a)(1)')
 * // => "21 C.F.R. § 117.3(a)(1)"
 * ```
 */
export function generateCFRCitation(
  title: number,
  section: string,
  subsection?: string
): string {
  // Validate section format (should be numeric.numeric)
  if (!/^\d+\.\d+$/.test(section)) {
    throw new Error(`Invalid section format: ${section}. Expected format: "123.456"`);
  }

  // Build base citation
  let citation = `${title} C.F.R. § ${section}`;

  // Add subsection if provided
  if (subsection) {
    citation += subsection;
  }

  return citation;
}

/**
 * Generate eCFR.gov URL for a specific section
 *
 * @param title CFR title number
 * @param part Part number
 * @param section Section number (e.g., "117.3")
 * @returns Direct URL to eCFR.gov
 *
 * @example
 * ```ts
 * generateECFRUrl(21, 117, '117.3')
 * // => "https://www.ecfr.gov/current/title-21/part-117/section-117.3"
 * ```
 */
export function generateECFRUrl(
  title: number,
  part: number,
  section: string
): string {
  return `https://www.ecfr.gov/current/title-${title}/part-${part}/section-${section}`;
}

/**
 * Generate hierarchy breadcrumbs for RAG context
 *
 * Creates a breadcrumb array showing the full regulatory path,
 * useful for providing context in vector search results.
 *
 * @param title CFR title number
 * @param chapter Chapter identifier (e.g., "I", "A")
 * @param part Part number
 * @param section Section number
 * @returns Array of hierarchy strings
 *
 * @example
 * ```ts
 * generateHierarchy(21, 'I', 117, '117.3')
 * // => ["Title 21", "Chapter I", "Part 117", "Section 117.3"]
 * ```
 */
export function generateHierarchy(
  title: number,
  chapter: string,
  part: number,
  section: string
): string[] {
  return [
    `Title ${title}`,
    `Chapter ${chapter}`,
    `Part ${part}`,
    `Section ${section}`,
  ];
}

/**
 * Parse section string into part and section components
 *
 * CFR sections follow the format "Part.Section" (e.g., "117.3").
 * This extracts the part number from the section string.
 *
 * @param sectionString Section number (e.g., "117.3", "1.1", "999.999")
 * @returns Object with part number and section string
 *
 * @example
 * ```ts
 * parseSection('117.3')
 * // => { part: 117, section: '117.3' }
 *
 * parseSection('1.1')
 * // => { part: 1, section: '1.1' }
 * ```
 */
export function parseSection(sectionString: string): {
  part: number;
  section: string;
} {
  // Validate format
  if (!/^\d+\.\d+$/.test(sectionString)) {
    throw new Error(
      `Invalid section format: ${sectionString}. Expected format: "123.456"`
    );
  }

  // Extract part number (everything before the decimal)
  const dotIndex = sectionString.indexOf('.');
  const partString = sectionString.substring(0, dotIndex);
  const part = parseInt(partString, 10);

  if (isNaN(part)) {
    throw new Error(`Failed to parse part number from section: ${sectionString}`);
  }

  return {
    part,
    section: sectionString,
  };
}

/**
 * Generate a unique chunk ID for a CFR section chunk
 *
 * Format: cfr-{title}-{part}-{section}-{chunkIndex}
 *
 * @param title CFR title number
 * @param part Part number
 * @param section Section number
 * @param chunkIndex Index of chunk within section (0-based)
 * @returns Unique chunk identifier
 *
 * @example
 * ```ts
 * generateChunkId(21, 117, '117.3', 0)
 * // => "cfr-21-117-117.3-0"
 * ```
 */
export function generateChunkId(
  title: number,
  part: number,
  section: string,
  chunkIndex: number
): string {
  return `cfr-${title}-${part}-${section}-${chunkIndex}`;
}

/**
 * Generate source ID for a CFR title
 *
 * Format: cfr-title-{number}
 *
 * @param titleNumber CFR title number
 * @returns Source identifier
 *
 * @example
 * ```ts
 * generateSourceId(21)
 * // => "cfr-title-21"
 * ```
 */
export function generateSourceId(titleNumber: number): string {
  return `cfr-title-${titleNumber}`;
}
