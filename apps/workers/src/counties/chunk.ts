/**
 * County Ordinance Chunking
 *
 * Splits Texas county ordinances into embedding-ready chunks.
 * Follows patterns established in texas/chunk.ts for consistency.
 *
 * Features:
 * - Section-level chunking with subsection splitting when needed
 * - 1500 token maximum per chunk (well under 8192 limit)
 * - 15% overlap for context preservation
 * - Proper Bluebook citation format
 * - Batch chunking for entire counties
 */

import type {
  CountyOrdinance,
  CountyChunk,
  CountySourceConfig,
} from './types';
import { countTokens } from '../lib/tokens';
import {
  generateCountyCitation,
  generateCountyChunkId,
  generateCountySourceId,
} from '../lib/citations';

/**
 * Maximum tokens per chunk
 * Well under 8192 embedding limit, allows headroom for metadata
 */
const MAX_CHUNK_TOKENS = 1500;

/**
 * Overlap ratio for chunk splitting
 * 15% overlap preserves cross-reference context
 */
const OVERLAP_RATIO = 0.15;

/**
 * Context for county ordinance chunking
 */
export interface CountyChunkContext {
  /** County name (e.g., "Harris") */
  county: string;
  /** FIPS code (e.g., "48201") */
  fipsCode: string;
  /** Code name (e.g., "Code of Ordinances") */
  codeName: string;
  /** Activity category tag (e.g., "subdivision", "zoning") */
  category?: string;
}

/**
 * Chunk a county ordinance section for embedding
 *
 * Strategy:
 * - If section <= 1500 tokens: return single chunk
 * - If section > 1500 tokens: split at subsection boundaries
 * - If no subsections: split at paragraph boundaries with 15% overlap
 *
 * @param ordinance County ordinance to chunk
 * @param context Chunk context (county, code name, category)
 * @returns Array of chunks (1+ chunks)
 *
 * @example
 * ```typescript
 * const ordinance = await adapter.fetchOrdinance();
 * const context = {
 *   county: 'Harris',
 *   fipsCode: '48201',
 *   codeName: 'Code of Ordinances',
 *   category: 'subdivision'
 * };
 * const chunks = chunkCountyOrdinance(ordinance, context);
 * console.log(chunks.length); // 1 or more
 * ```
 */
export function chunkCountyOrdinance(
  ordinance: CountyOrdinance,
  context: CountyChunkContext
): CountyChunk[] {
  const tokenCount = countTokens(ordinance.text);

  // Single chunk if within limit
  if (tokenCount <= MAX_CHUNK_TOKENS) {
    return [
      {
        chunkId: generateCountyChunkId(context.county, ordinance.chapter, ordinance.section, 0),
        sourceId: generateCountySourceId(context.county),
        sourceType: 'county',
        text: ordinance.text,
        citation: generateCountyCitation(context.county, context.codeName, ordinance.section),
        url: ordinance.sourceUrl,
        county: context.county,
        fipsCode: context.fipsCode,
        chapter: ordinance.chapter,
        section: ordinance.section,
        chunkIndex: 0,
        totalChunks: 1,
        category: context.category,
      },
    ];
  }

  // Multiple chunks needed
  // Try splitting at subsection boundaries first
  if (ordinance.subsections && ordinance.subsections.length > 0) {
    return chunkBySubsections(ordinance, context);
  }

  // No subsections: split at paragraph boundaries with overlap
  return chunkByParagraphs(ordinance, context);
}

/**
 * Chunk ordinance by subsection boundaries
 *
 * Each subsection becomes a chunk (if within token limit).
 * If subsection exceeds limit, further split at paragraphs.
 */
function chunkBySubsections(
  ordinance: CountyOrdinance,
  context: CountyChunkContext
): CountyChunk[] {
  const chunks: CountyChunk[] = [];
  const subsections = ordinance.subsections ?? [];

  for (let i = 0; i < subsections.length; i++) {
    const subsection = subsections[i];
    if (!subsection) continue; // TypeScript safety
    const tokenCount = countTokens(subsection.text);

    if (tokenCount <= MAX_CHUNK_TOKENS) {
      // Subsection fits in single chunk
      chunks.push({
        chunkId: generateCountyChunkId(context.county, ordinance.chapter, ordinance.section, chunks.length),
        sourceId: generateCountySourceId(context.county),
        sourceType: 'county',
        text: subsection.text,
        citation: `${generateCountyCitation(context.county, context.codeName, ordinance.section)} ${subsection.id}`,
        url: ordinance.sourceUrl,
        county: context.county,
        fipsCode: context.fipsCode,
        chapter: ordinance.chapter,
        section: ordinance.section,
        chunkIndex: chunks.length,
        totalChunks: 0, // Will update after
        category: context.category,
      });
    } else {
      // Subsection too large: split at paragraph boundaries
      const subChunks = splitWithOverlap(subsection.text, MAX_CHUNK_TOKENS, OVERLAP_RATIO);
      for (const subChunkText of subChunks) {
        chunks.push({
          chunkId: generateCountyChunkId(context.county, ordinance.chapter, ordinance.section, chunks.length),
          sourceId: generateCountySourceId(context.county),
          sourceType: 'county',
          text: subChunkText,
          citation: `${generateCountyCitation(context.county, context.codeName, ordinance.section)} ${subsection.id}`,
          url: ordinance.sourceUrl,
          county: context.county,
          fipsCode: context.fipsCode,
          chapter: ordinance.chapter,
          section: ordinance.section,
          chunkIndex: chunks.length,
          totalChunks: 0, // Will update after
          category: context.category,
        });
      }
    }
  }

  // Update totalChunks
  for (const chunk of chunks) {
    chunk.totalChunks = chunks.length;
  }

  return chunks;
}

/**
 * Chunk ordinance by paragraph boundaries with overlap
 */
function chunkByParagraphs(
  ordinance: CountyOrdinance,
  context: CountyChunkContext
): CountyChunk[] {
  const textChunks = splitWithOverlap(ordinance.text, MAX_CHUNK_TOKENS, OVERLAP_RATIO);

  return textChunks.map((text, index) => ({
    chunkId: generateCountyChunkId(context.county, ordinance.chapter, ordinance.section, index),
    sourceId: generateCountySourceId(context.county),
    sourceType: 'county',
    text,
    citation: generateCountyCitation(context.county, context.codeName, ordinance.section),
    url: ordinance.sourceUrl,
    county: context.county,
    fipsCode: context.fipsCode,
    chapter: ordinance.chapter,
    section: ordinance.section,
    chunkIndex: index,
    totalChunks: textChunks.length,
    category: context.category,
  }));
}

/**
 * Split text at paragraph boundaries with overlap
 *
 * Strategy:
 * - Split text into paragraphs (double newline)
 * - Combine paragraphs until token limit reached
 * - Add 15% overlap from previous chunk for context
 *
 * @param text Text to split
 * @param maxTokens Maximum tokens per chunk
 * @param overlapRatio Overlap ratio (0.15 = 15%)
 * @returns Array of text chunks with overlap
 */
export function splitWithOverlap(
  text: string,
  maxTokens: number,
  overlapRatio: number
): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokens = 0;

  // Calculate overlap tokens
  const overlapTokens = Math.floor(maxTokens * overlapRatio);

  for (const paragraph of paragraphs) {
    const paragraphTokens = countTokens(paragraph);

    // Check if adding this paragraph exceeds limit
    if (currentTokens + paragraphTokens > maxTokens && currentChunk.length > 0) {
      // Save current chunk
      chunks.push(currentChunk.join('\n\n'));

      // Start new chunk with overlap from previous
      const overlapText = getOverlapText(currentChunk, overlapTokens);
      currentChunk = overlapText ? [overlapText] : [];
      currentTokens = overlapText ? countTokens(overlapText) : 0;
    }

    // Add paragraph to current chunk
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
 * Get overlap text from previous chunk
 *
 * Takes last N tokens from chunk to provide context.
 *
 * @param chunk Array of paragraphs
 * @param targetTokens Target overlap tokens
 * @returns Overlap text or empty string
 */
export function getOverlapText(chunk: string[], targetTokens: number): string {
  if (chunk.length === 0) return '';

  // Work backwards from end of chunk
  const overlapParagraphs: string[] = [];
  let totalTokens = 0;

  for (let i = chunk.length - 1; i >= 0; i--) {
    const paragraph = chunk[i];
    if (!paragraph) continue; // TypeScript safety
    const tokens = countTokens(paragraph);

    if (totalTokens + tokens <= targetTokens) {
      overlapParagraphs.unshift(paragraph);
      totalTokens += tokens;
    } else {
      break;
    }
  }

  return overlapParagraphs.join('\n\n');
}

/**
 * Batch chunk all ordinances from a county
 *
 * Processes all ordinances and returns flat array of chunks.
 *
 * @param ordinances Array of county ordinances
 * @param config County source configuration
 * @param codeName Code name for citations (e.g., "Code of Ordinances")
 * @returns Flat array of all chunks
 *
 * @example
 * ```typescript
 * const ordinances: CountyOrdinance[] = [];
 * for await (const ord of adapter.fetchOrdinances()) {
 *   ordinances.push(ord);
 * }
 * const chunks = chunkCounty(ordinances, harrisConfig, 'Code of Ordinances');
 * console.log(`Created ${chunks.length} chunks`);
 * ```
 */
export function chunkCounty(
  ordinances: CountyOrdinance[],
  config: CountySourceConfig,
  codeName: string = 'Code of Ordinances'
): CountyChunk[] {
  const allChunks: CountyChunk[] = [];

  for (const ordinance of ordinances) {
    const context: CountyChunkContext = {
      county: config.name,
      fipsCode: config.fipsCode,
      codeName,
      category: config.categories[0] ?? undefined, // Use primary category
    };

    const chunks = chunkCountyOrdinance(ordinance, context);
    allChunks.push(...chunks);
  }

  return allChunks;
}

/**
 * Calculate chunk statistics
 *
 * Useful for monitoring chunk quality and distribution.
 *
 * @param chunks Array of county chunks
 * @returns Statistics object
 *
 * @example
 * ```typescript
 * const stats = getCountyChunkStats(chunks);
 * console.log(`Total: ${stats.totalChunks}, Avg: ${stats.avgTokens}, Max: ${stats.maxTokens}`);
 * ```
 */
export function getCountyChunkStats(chunks: CountyChunk[]): {
  totalChunks: number;
  avgTokens: number;
  maxTokens: number;
  minTokens: number;
  byCounty: Record<string, number>;
} {
  if (chunks.length === 0) {
    return { totalChunks: 0, avgTokens: 0, maxTokens: 0, minTokens: 0, byCounty: {} };
  }

  const tokenCounts = chunks.map(chunk => countTokens(chunk.text));
  const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0);

  // Count chunks by county
  const byCounty: Record<string, number> = {};
  for (const chunk of chunks) {
    byCounty[chunk.county] = (byCounty[chunk.county] ?? 0) + 1;
  }

  return {
    totalChunks: chunks.length,
    avgTokens: Math.round(totalTokens / chunks.length),
    maxTokens: Math.max(...tokenCounts),
    minTokens: Math.min(...tokenCounts),
    byCounty,
  };
}
