/**
 * Municipal Ordinance Chunking
 *
 * Splits municipal ordinances into embedding-ready chunks.
 * Respects legal structure (subsections) and token limits.
 *
 * Features:
 * - Section-level chunking with subsection splitting when needed
 * - 1500 token maximum per chunk (well under 8192 limit)
 * - 15% overlap for context preservation
 * - Proper citation format (Bluebook)
 * - Batch chunking for entire cities
 */

import type {
  MunicipalOrdinance,
  MunicipalChunk,
  MunicipalCityConfig,
} from './types';
import { countTokens } from '../lib/tokens';
import {
  generateMunicipalCitation,
  generateMunicipalChunkId,
  generateMunicipalHierarchy,
} from '../lib/citations';

/**
 * Maximum tokens per chunk
 * Well under 8192 embedding limit, allows headroom for metadata
 */
const MAX_TOKENS = 1500;

/**
 * Overlap ratio for chunk splitting
 * 15% overlap preserves cross-reference context
 */
const OVERLAP_PERCENT = 0.15;

/**
 * Chunk statistics for monitoring chunk quality
 */
export interface ChunkStats {
  /** Total number of chunks created */
  totalChunks: number;
  /** Total tokens across all chunks */
  totalTokens: number;
  /** Average tokens per chunk */
  avgTokens: number;
  /** Minimum tokens in any chunk */
  minTokens: number;
  /** Maximum tokens in any chunk */
  maxTokens: number;
}

/**
 * Chunk a municipal ordinance section for embedding
 *
 * Strategy:
 * - If section <= 1500 tokens: return single chunk
 * - If section > 1500 tokens: split at subsection boundaries
 * - If no subsections: split at paragraph boundaries with 15% overlap
 *
 * @param ordinance Municipal ordinance to chunk
 * @param cityConfig City configuration for citation generation
 * @returns Array of chunks (1+ chunks)
 *
 * @example
 * ```typescript
 * const ordinance = await getMunicipalOrdinance('houston', '1', '1-2');
 * const cityConfig = getCityById('houston');
 * const chunks = chunkMunicipalOrdinance(ordinance, cityConfig!);
 * console.log(chunks.length); // 1 or more
 * ```
 */
export function chunkMunicipalOrdinance(
  ordinance: MunicipalOrdinance,
  cityConfig: MunicipalCityConfig
): MunicipalChunk[] {
  const tokenCount = countTokens(ordinance.text);

  // Single chunk if within limit
  if (tokenCount <= MAX_TOKENS) {
    return [
      {
        chunkId: generateMunicipalChunkId(
          ordinance.cityId,
          ordinance.chapter,
          ordinance.section,
          0
        ),
        cityId: ordinance.cityId,
        chapter: ordinance.chapter,
        section: ordinance.section,
        text: ordinance.text,
        citation: generateMunicipalCitation(cityConfig.name, ordinance.section),
        hierarchy: generateMunicipalHierarchy(
          cityConfig.name,
          ordinance.chapter,
          ordinance.section
        ),
        sourceUrl: ordinance.sourceUrl,
        tokenCount,
      },
    ];
  }

  // Multiple chunks needed
  // Try splitting at subsection boundaries first
  if (ordinance.subsections && ordinance.subsections.length > 0) {
    return chunkBySubsections(ordinance, cityConfig);
  }

  // No subsections: split at paragraph boundaries with overlap
  return chunkByParagraphs(ordinance, cityConfig);
}

/**
 * Chunk ordinance by subsection boundaries
 *
 * Each subsection becomes a chunk (if within token limit).
 * If subsection exceeds limit, further split at paragraphs.
 */
function chunkBySubsections(
  ordinance: MunicipalOrdinance,
  cityConfig: MunicipalCityConfig
): MunicipalChunk[] {
  const chunks: MunicipalChunk[] = [];
  const subsections = ordinance.subsections ?? [];

  for (let i = 0; i < subsections.length; i++) {
    const subsection = subsections[i];
    if (!subsection) continue; // TypeScript safety
    const tokenCount = countTokens(subsection.text);

    if (tokenCount <= MAX_TOKENS) {
      // Subsection fits in single chunk
      chunks.push({
        chunkId: generateMunicipalChunkId(
          ordinance.cityId,
          ordinance.chapter,
          ordinance.section,
          chunks.length
        ),
        cityId: ordinance.cityId,
        chapter: ordinance.chapter,
        section: ordinance.section,
        text: subsection.text,
        citation: `${generateMunicipalCitation(cityConfig.name, ordinance.section)} ${subsection.id}`,
        hierarchy: generateMunicipalHierarchy(
          cityConfig.name,
          ordinance.chapter,
          `${ordinance.section} ${subsection.id}`
        ),
        sourceUrl: ordinance.sourceUrl,
        tokenCount,
      });
    } else {
      // Subsection too large: split at paragraph boundaries
      const subChunks = splitWithOverlap(
        subsection.text,
        MAX_TOKENS,
        OVERLAP_PERCENT
      );
      for (const subChunkText of subChunks) {
        const subTokenCount = countTokens(subChunkText);
        chunks.push({
          chunkId: generateMunicipalChunkId(
            ordinance.cityId,
            ordinance.chapter,
            ordinance.section,
            chunks.length
          ),
          cityId: ordinance.cityId,
          chapter: ordinance.chapter,
          section: ordinance.section,
          text: subChunkText,
          citation: `${generateMunicipalCitation(cityConfig.name, ordinance.section)} ${subsection.id}`,
          hierarchy: generateMunicipalHierarchy(
            cityConfig.name,
            ordinance.chapter,
            `${ordinance.section} ${subsection.id}`
          ),
          sourceUrl: ordinance.sourceUrl,
          tokenCount: subTokenCount,
        });
      }
    }
  }

  return chunks;
}

/**
 * Chunk ordinance by paragraph boundaries with overlap
 */
function chunkByParagraphs(
  ordinance: MunicipalOrdinance,
  cityConfig: MunicipalCityConfig
): MunicipalChunk[] {
  const textChunks = splitWithOverlap(ordinance.text, MAX_TOKENS, OVERLAP_PERCENT);

  return textChunks.map((text, index) => {
    const tokenCount = countTokens(text);
    return {
      chunkId: generateMunicipalChunkId(
        ordinance.cityId,
        ordinance.chapter,
        ordinance.section,
        index
      ),
      cityId: ordinance.cityId,
      chapter: ordinance.chapter,
      section: ordinance.section,
      text,
      citation: generateMunicipalCitation(cityConfig.name, ordinance.section),
      hierarchy: generateMunicipalHierarchy(
        cityConfig.name,
        ordinance.chapter,
        ordinance.section
      ),
      sourceUrl: ordinance.sourceUrl,
      tokenCount,
    };
  });
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
function splitWithOverlap(
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
function getOverlapText(chunk: string[], targetTokens: number): string {
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
 * Batch chunk all ordinances for a city
 *
 * Processes all ordinances and returns flat array of chunks with statistics.
 *
 * @param ordinances Array of municipal ordinances
 * @param cityConfig City configuration
 * @returns Object with chunks array and statistics
 *
 * @example
 * ```typescript
 * const ordinances = await listMunicipalOrdinances('houston');
 * const cityConfig = getCityById('houston');
 * const { chunks, stats } = chunkCity(ordinances, cityConfig!);
 * console.log(`Created ${stats.totalChunks} chunks, avg ${stats.avgTokens} tokens`);
 * ```
 */
export function chunkCity(
  ordinances: MunicipalOrdinance[],
  cityConfig: MunicipalCityConfig
): { chunks: MunicipalChunk[]; stats: ChunkStats } {
  const allChunks: MunicipalChunk[] = [];

  for (const ordinance of ordinances) {
    const chunks = chunkMunicipalOrdinance(ordinance, cityConfig);
    allChunks.push(...chunks);
  }

  const stats = getMunicipalChunkStats(allChunks);

  return { chunks: allChunks, stats };
}

/**
 * Calculate chunk statistics
 *
 * Useful for monitoring chunk quality and distribution.
 * Used for dry-run validation before embedding.
 *
 * @param chunks Array of municipal chunks
 * @returns Statistics object
 *
 * @example
 * ```typescript
 * const stats = getMunicipalChunkStats(chunks);
 * console.log(`Total: ${stats.totalChunks}, Avg: ${stats.avgTokens}, Max: ${stats.maxTokens}`);
 * ```
 */
export function getMunicipalChunkStats(chunks: MunicipalChunk[]): ChunkStats {
  if (chunks.length === 0) {
    return {
      totalChunks: 0,
      totalTokens: 0,
      avgTokens: 0,
      minTokens: 0,
      maxTokens: 0,
    };
  }

  const tokenCounts = chunks.map((chunk) => chunk.tokenCount);
  const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0);

  return {
    totalChunks: chunks.length,
    totalTokens,
    avgTokens: Math.round(totalTokens / chunks.length),
    minTokens: Math.min(...tokenCounts),
    maxTokens: Math.max(...tokenCounts),
  };
}
