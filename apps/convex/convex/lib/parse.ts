import type { RetrievedChunk, Citation, Permit, JurisdictionSection } from '../query/types';

/**
 * Response Parsing Module
 *
 * Parses Claude's generated answer into structured format with:
 * - Citations extracted and validated
 * - Permits extracted into dedicated array
 * - Jurisdiction sections separated by level
 */

/**
 * Extract citations from answer text and map to source chunks.
 *
 * Finds all [N] references in text and maps them to the corresponding
 * chunk from retrieval results.
 *
 * @param text - Generated answer text with citation references [1], [2], etc.
 * @param chunks - Retrieved chunks from Pinecone (indexed from 0)
 * @returns Array of unique citations
 */
export function extractCitations(text: string, chunks: RetrievedChunk[]): Citation[] {
  const citationRegex = /\[(\d+)\]/g;
  const citationIds = new Set<number>();
  const citations: Citation[] = [];

  // Find all [N] references
  let match;
  while ((match = citationRegex.exec(text)) !== null) {
    if (match[1]) {
      const id = parseInt(match[1], 10);
      citationIds.add(id);
    }
  }

  // Map each unique citation ID to corresponding chunk
  for (const id of Array.from(citationIds).sort((a, b) => a - b)) {
    const chunkIndex = id - 1; // Citations are 1-based, array is 0-based
    if (chunkIndex >= 0 && chunkIndex < chunks.length) {
      const chunk = chunks[chunkIndex];
      if (chunk) {
        citations.push({
          id,
          citation: chunk.citation,
          text: chunk.text.substring(0, 200) + (chunk.text.length > 200 ? '...' : ''),
          url: chunk.url,
          jurisdiction: chunk.jurisdiction,
          sourceType: chunk.sourceType,
        });
      }
    }
  }

  return citations;
}

/**
 * Validate that all citation references in text correspond to actual chunks.
 *
 * @param text - Generated answer text
 * @param chunks - Retrieved chunks
 * @returns Validation result with list of invalid references
 */
export function validateCitations(
  text: string,
  chunks: RetrievedChunk[]
): { valid: boolean; invalidRefs: number[] } {
  const citationRegex = /\[(\d+)\]/g;
  const invalidRefs: number[] = [];

  let match;
  while ((match = citationRegex.exec(text)) !== null) {
    if (match[1]) {
      const id = parseInt(match[1], 10);
      const chunkIndex = id - 1;

      // Check if citation references a non-existent chunk
      if (chunkIndex < 0 || chunkIndex >= chunks.length) {
        if (!invalidRefs.includes(id)) {
          invalidRefs.push(id);
        }
      }
    }
  }

  return {
    valid: invalidRefs.length === 0,
    invalidRefs,
  };
}

/**
 * Extract required permits from the answer text.
 *
 * Looks for "Required Permits and Licenses" section and parses
 * structured permit entries.
 *
 * @param text - Generated answer text
 * @returns Array of permits
 */
export function extractPermits(text: string): Permit[] {
  const permits: Permit[] = [];

  // Find permits section (case-insensitive)
  const permitSectionRegex = /###?\s*Required Permits.*?(?=###|$)/gis;
  const permitSection = text.match(permitSectionRegex)?.[0];

  if (!permitSection) {
    return permits;
  }

  // Parse individual permits using pattern matching
  // Expected format:
  // **Permit Name**: Food Establishment Permit
  // **Issuing Agency**: Texas Department of State Health Services
  // **Jurisdiction**: TX
  // **Link**: https://...
  // **Regulatory Reference**: 25 TAC § 228.4

  const permitEntryRegex = /\*\*Permit Name\*\*:\s*(.+?)(?=\n|$)[\s\S]*?\*\*Issuing Agency\*\*:\s*(.+?)(?=\n|$)[\s\S]*?\*\*Jurisdiction\*\*:\s*(.+?)(?=\n|$)(?:[\s\S]*?\*\*Link\*\*:\s*(.+?)(?=\n|$))?[\s\S]*?\*\*Regulatory Reference\*\*:\s*(.+?)(?=\n|$)/gi;

  let match;
  while ((match = permitEntryRegex.exec(permitSection)) !== null) {
    if (match[1] && match[2] && match[3] && match[5]) {
      permits.push({
        name: match[1].trim(),
        issuingAgency: match[2].trim(),
        jurisdiction: match[3].trim(),
        url: match[4]?.trim(),
        citation: match[5].trim(),
      });
    }
  }

  return permits;
}

/**
 * Parse answer text into jurisdiction sections.
 *
 * Splits the answer by jurisdiction-level headers (### Federal, ### State, etc.)
 * and extracts content for each level.
 *
 * @param text - Generated answer text
 * @returns Array of jurisdiction sections (without citations/permits - those are added separately)
 */
export function parseJurisdictionSections(text: string): JurisdictionSection[] {
  const sections: JurisdictionSection[] = [];

  // Define jurisdiction levels with their regex patterns
  const jurisdictionPatterns = [
    { level: 'federal' as const, pattern: /###\s*Federal.*?\n([\s\S]*?)(?=###|$)/i },
    { level: 'state' as const, pattern: /###\s*State.*?\n([\s\S]*?)(?=###|$)/i },
    { level: 'county' as const, pattern: /###\s*County.*?\n([\s\S]*?)(?=###|$)/i },
    { level: 'municipal' as const, pattern: /###\s*Municipal.*?\n([\s\S]*?)(?=###|$)/i },
  ];

  for (const { level, pattern } of jurisdictionPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Extract jurisdiction name from header (e.g., "### Federal Requirements" or "### Texas State")
      const headerMatch = text.match(new RegExp(`###\\s*${level}[^\\n]*`, 'i'));
      const header = headerMatch?.[0] || '';
      const jurisdictionName = extractJurisdictionName(header, level);

      sections.push({
        level,
        jurisdictionName,
        content: match[1].trim(),
        citations: [], // Will be populated by caller
        permits: [], // Will be populated by caller
      });
    }
  }

  return sections;
}

/**
 * Extract human-readable jurisdiction name from section header.
 *
 * @param header - Section header text (e.g., "### Texas State Requirements")
 * @param level - Jurisdiction level
 * @returns Human-readable jurisdiction name
 */
function extractJurisdictionName(header: string, level: string): string {
  // Remove "###" and level keyword, extract remaining text
  const cleaned = header
    .replace(/###/g, '')
    .replace(new RegExp(level, 'i'), '')
    .replace(/requirements?/i, '')
    .trim();

  // If we have a specific name (e.g., "Texas"), use it
  if (cleaned) {
    return cleaned;
  }

  // Otherwise, capitalize the level
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * Parse Claude's generated answer into structured format.
 *
 * Main orchestrator that:
 * 1. Validates citations
 * 2. Extracts citations and maps to chunks
 * 3. Extracts permits
 * 4. Parses jurisdiction sections
 *
 * @param rawAnswer - Raw text response from Claude
 * @param chunks - Retrieved chunks used to generate the answer
 * @returns Parsed answer with sections, citations, permits, and warnings
 */
export function parseAnswer(
  rawAnswer: string,
  chunks: RetrievedChunk[]
): {
  sections: JurisdictionSection[];
  citations: Citation[];
  permits: Permit[];
  warnings: string[];
} {
  const warnings: string[] = [];

  // Validate citations
  const validation = validateCitations(rawAnswer, chunks);
  if (!validation.valid) {
    warnings.push(
      `Invalid citation references found: [${validation.invalidRefs.join(', ')}] (references to non-existent chunks)`
    );
  }

  // Extract citations
  const citations = extractCitations(rawAnswer, chunks);

  // Extract permits
  const permits = extractPermits(rawAnswer);

  // Parse jurisdiction sections
  const sections = parseJurisdictionSections(rawAnswer);

  // Note: We don't populate citations/permits arrays within each section here.
  // That can be done by the caller if needed, by analyzing which citations
  // appear in each section's content.

  return {
    sections,
    citations,
    permits,
    warnings,
  };
}
