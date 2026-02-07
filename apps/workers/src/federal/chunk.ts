/**
 * CFR Chunking Pipeline
 *
 * Structure-aware chunking for Code of Federal Regulations text.
 * Preserves legal hierarchy, generates citations and URLs, and splits
 * oversized sections at subsection boundaries with overlap.
 */

import type { CFRSection, CFRPart, CFRChunk } from './types';
// Use simple token estimation to avoid CPU-intensive tiktoken initialization
// This makes workflows compatible with Cloudflare's CPU limits
import { countTokens } from '../lib/tokens-simple';
import {
  generateCFRCitation,
  generateECFRUrl,
  generateHierarchy,
  generateChunkId,
  generateSourceId,
} from '../lib/citations';

/**
 * Maximum tokens per chunk (well under 8192 embedding limit)
 * Provides headroom for metadata in vector store
 */
const MAX_CHUNK_TOKENS = 1500;

/**
 * Overlap ratio for splitting very long subsections
 * 15% overlap preserves cross-reference context ("as defined in paragraph (a)")
 */
const OVERLAP_RATIO = 0.15;

/**
 * Chunk context - hierarchical information for a section
 */
export interface ChunkContext {
  /** Title number (1-50) */
  titleNumber: number;
  /** Full title name */
  titleName: string;
  /** Chapter identifier (Roman numerals or letters) */
  chapter: string;
  /** Part number */
  partNumber: number;
  /** Part name/title */
  partName: string;
  /** Activity category tags from TARGET_TITLES (optional) */
  category?: string;
}

/**
 * Subsection with identifier and text
 */
interface SubsectionPart {
  /** Subsection identifier (e.g., "(a)", "(a)(1)") */
  id: string;
  /** Subsection text content */
  text: string;
}

/**
 * Chunk CFR section into embeddings-ready chunks
 *
 * Preserves legal structure by:
 * 1. Keeping small sections whole (≤ 1500 tokens)
 * 2. Splitting large sections at subsection boundaries
 * 3. Further splitting very long subsections with overlap
 *
 * @param section CFR section with text and metadata
 * @param context Hierarchical context for chunk metadata
 * @returns Array of chunks (usually 1, more if section is large)
 *
 * @example
 * ```ts
 * const chunks = chunkCFRSection(section, {
 *   titleNumber: 21,
 *   titleName: 'Food and Drugs',
 *   chapter: 'I',
 *   partNumber: 117,
 *   partName: 'Current Good Manufacturing Practice',
 *   category: 'food-safety'
 * });
 * ```
 */
export function chunkCFRSection(
  section: CFRSection,
  context: ChunkContext
): CFRChunk[] {
  const { titleNumber, chapter, partNumber, category } = context;

  // Count tokens in full section
  const tokenCount = countTokens(section.text);

  // If section fits in one chunk, return it whole
  if (tokenCount <= MAX_CHUNK_TOKENS) {
    const citation = generateCFRCitation(titleNumber, section.number);
    const url = generateECFRUrl(titleNumber, partNumber, section.number);
    const hierarchy = generateHierarchy(titleNumber, chapter, partNumber, section.number);

    return [
      {
        chunkId: generateChunkId(titleNumber, partNumber, section.number, 0),
        sourceId: generateSourceId(titleNumber),
        text: section.text,
        citation,
        url,
        title: titleNumber,
        part: partNumber,
        section: section.number,
        hierarchy,
        category,
        effectiveDate: section.effectiveDate,
        lastAmended: section.lastAmended,
        chunkIndex: 0,
        totalChunks: 1,
      },
    ];
  }

  // Section is too large - split at subsection boundaries
  console.warn(
    `Section ${generateCFRCitation(titleNumber, section.number)} requires splitting (${tokenCount} tokens)`
  );

  const subsections = splitAtSubsections(section.text);

  // If no subsections detected, split at paragraph boundaries with overlap
  if (subsections.length === 0) {
    return splitSectionWithOverlap(section, context);
  }

  // Process each subsection
  const chunks: CFRChunk[] = [];
  let chunkIndex = 0;

  for (const subsection of subsections) {
    const subsectionTokens = countTokens(subsection.text);

    // If subsection fits in one chunk
    if (subsectionTokens <= MAX_CHUNK_TOKENS) {
      const citation = generateCFRCitation(
        titleNumber,
        section.number,
        subsection.id
      );
      const url = generateECFRUrl(titleNumber, partNumber, section.number);
      const hierarchy = generateHierarchy(titleNumber, chapter, partNumber, section.number);

      chunks.push({
        chunkId: generateChunkId(titleNumber, partNumber, section.number, chunkIndex),
        sourceId: generateSourceId(titleNumber),
        text: subsection.text,
        citation,
        url,
        title: titleNumber,
        part: partNumber,
        section: section.number,
        subsection: subsection.id,
        hierarchy,
        category,
        effectiveDate: section.effectiveDate,
        lastAmended: section.lastAmended,
        chunkIndex,
        totalChunks: 0, // Will be updated at end
      });

      chunkIndex++;
    } else {
      // Subsection is still too large - split with overlap
      const splitTexts = splitWithOverlap(subsection.text, MAX_CHUNK_TOKENS, OVERLAP_RATIO);

      for (const text of splitTexts) {
        const citation = generateCFRCitation(
          titleNumber,
          section.number,
          subsection.id
        );
        const url = generateECFRUrl(titleNumber, partNumber, section.number);
        const hierarchy = generateHierarchy(titleNumber, chapter, partNumber, section.number);

        chunks.push({
          chunkId: generateChunkId(titleNumber, partNumber, section.number, chunkIndex),
          sourceId: generateSourceId(titleNumber),
          text,
          citation,
          url,
          title: titleNumber,
          part: partNumber,
          section: section.number,
          subsection: subsection.id,
          hierarchy,
          category,
          effectiveDate: section.effectiveDate,
          lastAmended: section.lastAmended,
          chunkIndex,
          totalChunks: 0, // Will be updated at end
        });

        chunkIndex++;
      }
    }
  }

  // Update totalChunks for all chunks
  const totalChunks = chunks.length;
  chunks.forEach(chunk => {
    chunk.totalChunks = totalChunks;
  });

  return chunks;
}

/**
 * Split section text at subsection boundaries
 *
 * Detects subsection markers in CFR text:
 * - (a), (b), (c)... (lowercase letters)
 * - (1), (2), (3)... (numbers)
 * - Nested: (a)(1), (b)(2)(i)
 *
 * @param text Full section text
 * @returns Array of subsections with identifiers
 */
function splitAtSubsections(text: string): SubsectionPart[] {
  const subsections: SubsectionPart[] = [];

  // Regex to match subsection markers at start of line or after whitespace
  // Matches: (a), (1), (a)(1), (b)(2)(i), etc.
  const subsectionPattern = /(?:^|\n)\s*(\([a-z0-9]+\)(?:\([a-z0-9]+\))*)\s+/gi;

  let match;
  let lastIndex = 0;
  let lastId = '';

  while ((match = subsectionPattern.exec(text)) !== null) {
    // If we have a previous subsection, save it
    if (lastId) {
      const subsectionText = text.substring(lastIndex, match.index).trim();
      if (subsectionText) {
        subsections.push({
          id: lastId,
          text: subsectionText,
        });
      }
    }

    // Store current subsection marker
    const capturedId = match[1];
    if (!capturedId) continue;
    lastId = capturedId;
    lastIndex = match.index + match[0].length;
  }

  // Add final subsection
  if (lastId && lastIndex < text.length) {
    const subsectionText = text.substring(lastIndex).trim();
    if (subsectionText) {
      subsections.push({
        id: lastId,
        text: subsectionText,
      });
    }
  }

  return subsections;
}

/**
 * Split text at paragraph boundaries with overlap
 *
 * Used as fallback for very long subsections that can't be split
 * at subsection boundaries. Adds 15% overlap to preserve cross-reference context.
 *
 * @param text Text to split
 * @param maxTokens Maximum tokens per chunk
 * @param overlapRatio Ratio of overlap between chunks (0.0 - 1.0)
 * @returns Array of text chunks with overlap
 */
function splitWithOverlap(
  text: string,
  maxTokens: number,
  overlapRatio: number
): string[] {
  // Split text into paragraphs (double newline or single newline with indent)
  const paragraphs = text.split(/\n\n+|\n(?=\s{2,})/).filter(p => p.trim());

  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    if (!paragraph) continue;
    const paragraphTokens = countTokens(paragraph);

    // If adding this paragraph exceeds limit, finalize current chunk
    if (currentTokens + paragraphTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n\n'));

      // Calculate overlap: take last N paragraphs for context
      const overlapTokenTarget = Math.floor(maxTokens * overlapRatio);
      const overlapParagraphs: string[] = [];
      let overlapTokens = 0;

      // Add paragraphs from end of current chunk for overlap
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        const overlapPara = currentChunk[j];
        if (!overlapPara) continue;
        const overlapParaTokens = countTokens(overlapPara);

        if (overlapTokens + overlapParaTokens > overlapTokenTarget) {
          break;
        }

        overlapParagraphs.unshift(overlapPara);
        overlapTokens += overlapParaTokens;
      }

      // Start new chunk with overlap
      currentChunk = overlapParagraphs;
      currentTokens = overlapTokens;
    }

    // Add current paragraph
    currentChunk.push(paragraph);
    currentTokens += paragraphTokens;
  }

  // Add final chunk
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}

/**
 * Split section with overlap when no subsections detected
 *
 * @param section CFR section to split
 * @param context Chunk context
 * @returns Array of chunks with overlap
 */
function splitSectionWithOverlap(
  section: CFRSection,
  context: ChunkContext
): CFRChunk[] {
  const { titleNumber, chapter, partNumber, category } = context;

  const splitTexts = splitWithOverlap(section.text, MAX_CHUNK_TOKENS, OVERLAP_RATIO);
  const chunks: CFRChunk[] = [];

  for (let i = 0; i < splitTexts.length; i++) {
    const text = splitTexts[i];
    if (!text) continue;

    const citation = generateCFRCitation(titleNumber, section.number);
    const url = generateECFRUrl(titleNumber, partNumber, section.number);
    const hierarchy = generateHierarchy(titleNumber, chapter, partNumber, section.number);

    chunks.push({
      chunkId: generateChunkId(titleNumber, partNumber, section.number, i),
      sourceId: generateSourceId(titleNumber),
      text,
      citation,
      url,
      title: titleNumber,
      part: partNumber,
      section: section.number,
      hierarchy,
      category,
      effectiveDate: section.effectiveDate,
      lastAmended: section.lastAmended,
      chunkIndex: i,
      totalChunks: splitTexts.length,
    });
  }

  return chunks;
}

/**
 * Chunk all sections in a CFR part
 *
 * Batch processing for entire parts. Returns flat array of all chunks.
 *
 * @param part CFR part with sections
 * @param context Context without part-specific fields
 * @returns Flat array of all chunks from all sections
 *
 * @example
 * ```ts
 * const chunks = chunkCFRPart(part, {
 *   titleNumber: 21,
 *   titleName: 'Food and Drugs',
 *   chapter: 'I',
 *   category: 'food-safety'
 * });
 * ```
 */
export function chunkCFRPart(
  part: CFRPart,
  context: Omit<ChunkContext, 'partNumber' | 'partName'>
): CFRChunk[] {
  console.log(`Chunking part ${part.number}: ${part.sections.length} sections`);

  const partContext: ChunkContext = {
    ...context,
    partNumber: part.number,
    partName: part.name,
  };

  const chunks = part.sections.flatMap(section =>
    chunkCFRSection(section, partContext)
  );

  // Validate no chunk exceeds limit
  const oversizedChunks = chunks.filter(chunk => {
    const tokens = countTokens(chunk.text);
    return tokens > MAX_CHUNK_TOKENS;
  });

  if (oversizedChunks.length > 0) {
    const details = oversizedChunks.map(chunk => {
      const tokens = countTokens(chunk.text);
      return `${chunk.citation}: ${tokens} tokens`;
    }).join(', ');

    throw new Error(
      `Chunking validation failed: ${oversizedChunks.length} chunks exceed ${MAX_CHUNK_TOKENS} token limit. Details: ${details}`
    );
  }

  const stats = getChunkStats(chunks);
  console.log(
    `Part ${part.number} chunked: ${stats.totalChunks} chunks, ${Math.round(stats.avgTokensPerChunk)} avg tokens` +
    (stats.oversizedSections > 0 ? `, ${stats.oversizedSections} sections required splitting` : '')
  );

  return chunks;
}

/**
 * Statistics about chunked data
 */
export interface ChunkStats {
  /** Total number of chunks generated */
  totalChunks: number;
  /** Total tokens across all chunks */
  totalTokens: number;
  /** Average tokens per chunk */
  avgTokensPerChunk: number;
  /** Maximum tokens in any chunk */
  maxTokensChunk: number;
  /** Number of sections chunked */
  sectionsChunked: number;
  /** Number of sections that required splitting */
  oversizedSections: number;
}

/**
 * Calculate statistics for chunked data
 *
 * Useful for monitoring pipeline performance and identifying
 * sections that require special handling.
 *
 * @param chunks Array of chunks to analyze
 * @returns Statistics object
 *
 * @example
 * ```ts
 * const stats = getChunkStats(chunks);
 * console.log(`Processed ${stats.sectionsChunked} sections into ${stats.totalChunks} chunks`);
 * console.log(`Average: ${stats.avgTokensPerChunk} tokens, Max: ${stats.maxTokensChunk} tokens`);
 * ```
 */
export function getChunkStats(chunks: CFRChunk[]): ChunkStats {
  let totalTokens = 0;
  let maxTokens = 0;
  const uniqueSections = new Set<string>();
  let oversizedSections = 0;

  for (const chunk of chunks) {
    const tokens = countTokens(chunk.text);
    totalTokens += tokens;
    maxTokens = Math.max(maxTokens, tokens);

    // Track unique sections
    const sectionKey = `${chunk.title}-${chunk.section}`;
    uniqueSections.add(sectionKey);

    // Count sections that were split (totalChunks > 1)
    if (chunk.totalChunks > 1 && chunk.chunkIndex === 0) {
      oversizedSections++;
    }
  }

  return {
    totalChunks: chunks.length,
    totalTokens,
    avgTokensPerChunk: chunks.length > 0 ? totalTokens / chunks.length : 0,
    maxTokensChunk: maxTokens,
    sectionsChunked: uniqueSections.size,
    oversizedSections,
  };
}
