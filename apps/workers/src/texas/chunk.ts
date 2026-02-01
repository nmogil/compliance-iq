/**
 * Texas Statute and TAC Chunking
 *
 * Splits Texas statutes and TAC rules into embedding-ready chunks.
 * Respects legal structure (subsections) and token limits.
 *
 * Features:
 * - Section-level chunking with subsection splitting when needed
 * - 1500 token maximum per chunk (well under 8192 limit)
 * - 15% overlap for context preservation
 * - Proper citation format (Bluebook)
 * - Batch chunking for entire codes/titles
 */

import type {
  TexasStatuteSection,
  TACRule,
  TACTitleConfig,
  TexasCodeConfig,
  TexasChunk,
} from './types';
import { countTokens } from '../lib/tokens';
import {
  generateTexasStatuteCitation,
  generateTACCitation,
  generateStatuteUrl,
  generateTACUrl,
  generateTexasChunkId,
  generateTexasSourceId,
  generateTexasHierarchy,
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
 * Context for Texas statute chunking
 */
export interface TexasChunkContext {
  /** Code abbreviation (e.g., "PE", "HS") */
  code: string;
  /** Full code name (e.g., "Penal Code") */
  codeName: string;
  /** Chapter number */
  chapter: string;
  /** Activity category tag (e.g., "criminal", "food-safety") */
  category?: string;
}

/**
 * Context for TAC chunking
 */
export interface TACChunkContext {
  /** TAC title number */
  title: number;
  /** Title name (e.g., "Economic Regulation") */
  titleName: string;
  /** Chapter number */
  chapter: string;
  /** Activity category tag (e.g., "alcohol", "licensing") */
  category?: string;
}

/**
 * Chunk a Texas statute section for embedding
 *
 * Strategy:
 * - If section ≤ 1500 tokens: return single chunk
 * - If section > 1500 tokens: split at subsection boundaries
 * - If no subsections: split at paragraph boundaries with 15% overlap
 *
 * @param section Texas statute section to chunk
 * @param context Chunk context (code, chapter, category)
 * @returns Array of chunks (1+ chunks)
 *
 * @example
 * ```typescript
 * const section = await fetchTexasStatute('PE', '30.02');
 * const context = {
 *   code: 'PE',
 *   codeName: 'Penal Code',
 *   chapter: '30',
 *   category: 'criminal'
 * };
 * const chunks = chunkTexasStatute(section, context);
 * console.log(chunks.length); // 1 or more
 * ```
 */
export function chunkTexasStatute(
  section: TexasStatuteSection,
  context: TexasChunkContext
): TexasChunk[] {
  const tokenCount = countTokens(section.text);

  // Single chunk if within limit
  if (tokenCount <= MAX_CHUNK_TOKENS) {
    return [
      {
        chunkId: generateTexasChunkId('statute', context.code, context.chapter, section.section, 0),
        sourceId: generateTexasSourceId('statute', context.code),
        sourceType: 'tx-statute',
        text: section.text,
        citation: generateTexasStatuteCitation(context.code, section.section),
        url: generateStatuteUrl(context.code, section.section),
        code: context.code,
        chapter: context.chapter,
        section: section.section,
        hierarchy: generateTexasHierarchy('statute', context.codeName, context.chapter, section.section),
        category: context.category,
        chunkIndex: 0,
        totalChunks: 1,
      },
    ];
  }

  // Multiple chunks needed
  // Try splitting at subsection boundaries first
  if (section.subsections && section.subsections.length > 0) {
    return chunkBySubsections(section, context);
  }

  // No subsections: split at paragraph boundaries with overlap
  return chunkByParagraphs(section, context);
}

/**
 * Chunk a TAC rule for embedding
 *
 * Strategy:
 * - If rule ≤ 1500 tokens: return single chunk
 * - If rule > 1500 tokens: split at subsection boundaries
 * - If no subsections: split at paragraph boundaries with 15% overlap
 *
 * @param rule TAC rule to chunk
 * @param context Chunk context (title, chapter, category)
 * @returns Array of chunks (1+ chunks)
 *
 * @example
 * ```typescript
 * const rule = await fetchTACRule(16, '5', '5.31');
 * const context = {
 *   title: 16,
 *   titleName: 'Economic Regulation',
 *   chapter: '5',
 *   category: 'alcohol'
 * };
 * const chunks = chunkTACRule(rule, context);
 * console.log(chunks.length); // 1 or more
 * ```
 */
export function chunkTACRule(rule: TACRule, context: TACChunkContext): TexasChunk[] {
  const tokenCount = countTokens(rule.text);

  // Single chunk if within limit
  if (tokenCount <= MAX_CHUNK_TOKENS) {
    return [
      {
        chunkId: generateTexasChunkId('tac', context.title, context.chapter, rule.section, 0),
        sourceId: generateTexasSourceId('tac', context.title),
        sourceType: 'tx-tac',
        text: rule.text,
        citation: generateTACCitation(context.title, rule.section),
        url: generateTACUrl(context.title, context.chapter, rule.section),
        tacTitle: context.title,
        chapter: context.chapter,
        section: rule.section,
        hierarchy: generateTexasHierarchy('tac', `Title ${context.title}: ${context.titleName}`, context.chapter, rule.section),
        category: context.category,
        chunkIndex: 0,
        totalChunks: 1,
      },
    ];
  }

  // Multiple chunks needed
  // Try splitting at subsection boundaries first
  if (rule.subsections && rule.subsections.length > 0) {
    return chunkTACBySubsections(rule, context);
  }

  // No subsections: split at paragraph boundaries with overlap
  return chunkTACByParagraphs(rule, context);
}

/**
 * Chunk statute by subsection boundaries
 *
 * Each subsection becomes a chunk (if within token limit).
 * If subsection exceeds limit, further split at paragraphs.
 */
function chunkBySubsections(
  section: TexasStatuteSection,
  context: TexasChunkContext
): TexasChunk[] {
  const chunks: TexasChunk[] = [];
  const subsections = section.subsections ?? [];

  for (let i = 0; i < subsections.length; i++) {
    const subsection = subsections[i];
    if (!subsection) continue; // TypeScript safety
    const tokenCount = countTokens(subsection.text);

    if (tokenCount <= MAX_CHUNK_TOKENS) {
      // Subsection fits in single chunk
      chunks.push({
        chunkId: generateTexasChunkId('statute', context.code, context.chapter, section.section, chunks.length),
        sourceId: generateTexasSourceId('statute', context.code),
        sourceType: 'tx-statute',
        text: subsection.text,
        citation: `${generateTexasStatuteCitation(context.code, section.section)} ${subsection.id}`,
        url: generateStatuteUrl(context.code, section.section),
        code: context.code,
        chapter: context.chapter,
        section: section.section,
        subsection: subsection.id,
        hierarchy: generateTexasHierarchy('statute', context.codeName, context.chapter, `${section.section} ${subsection.id}`),
        category: context.category,
        chunkIndex: chunks.length,
        totalChunks: 0, // Will update after
      });
    } else {
      // Subsection too large: split at paragraph boundaries
      const subChunks = splitWithOverlap(subsection.text, MAX_CHUNK_TOKENS, OVERLAP_RATIO);
      for (const subChunkText of subChunks) {
        chunks.push({
          chunkId: generateTexasChunkId('statute', context.code, context.chapter, section.section, chunks.length),
          sourceId: generateTexasSourceId('statute', context.code),
          sourceType: 'tx-statute',
          text: subChunkText,
          citation: `${generateTexasStatuteCitation(context.code, section.section)} ${subsection.id}`,
          url: generateStatuteUrl(context.code, section.section),
          code: context.code,
          chapter: context.chapter,
          section: section.section,
          subsection: subsection.id,
          hierarchy: generateTexasHierarchy('statute', context.codeName, context.chapter, `${section.section} ${subsection.id}`),
          category: context.category,
          chunkIndex: chunks.length,
          totalChunks: 0, // Will update after
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
 * Chunk TAC rule by subsection boundaries
 */
function chunkTACBySubsections(rule: TACRule, context: TACChunkContext): TexasChunk[] {
  const chunks: TexasChunk[] = [];
  const subsections = rule.subsections ?? [];

  for (let i = 0; i < subsections.length; i++) {
    const subsection = subsections[i];
    if (!subsection) continue; // TypeScript safety
    const tokenCount = countTokens(subsection.text);

    if (tokenCount <= MAX_CHUNK_TOKENS) {
      // Subsection fits in single chunk
      chunks.push({
        chunkId: generateTexasChunkId('tac', context.title, context.chapter, rule.section, chunks.length),
        sourceId: generateTexasSourceId('tac', context.title),
        sourceType: 'tx-tac',
        text: subsection.text,
        citation: `${generateTACCitation(context.title, rule.section)} ${subsection.id}`,
        url: generateTACUrl(context.title, context.chapter, rule.section),
        tacTitle: context.title,
        chapter: context.chapter,
        section: rule.section,
        subsection: subsection.id,
        hierarchy: generateTexasHierarchy('tac', `Title ${context.title}: ${context.titleName}`, context.chapter, `${rule.section} ${subsection.id}`),
        category: context.category,
        chunkIndex: chunks.length,
        totalChunks: 0, // Will update after
      });
    } else {
      // Subsection too large: split at paragraph boundaries
      const subChunks = splitWithOverlap(subsection.text, MAX_CHUNK_TOKENS, OVERLAP_RATIO);
      for (const subChunkText of subChunks) {
        chunks.push({
          chunkId: generateTexasChunkId('tac', context.title, context.chapter, rule.section, chunks.length),
          sourceId: generateTexasSourceId('tac', context.title),
          sourceType: 'tx-tac',
          text: subChunkText,
          citation: `${generateTACCitation(context.title, rule.section)} ${subsection.id}`,
          url: generateTACUrl(context.title, context.chapter, rule.section),
          tacTitle: context.title,
          chapter: context.chapter,
          section: rule.section,
          subsection: subsection.id,
          hierarchy: generateTexasHierarchy('tac', `Title ${context.title}: ${context.titleName}`, context.chapter, `${rule.section} ${subsection.id}`),
          category: context.category,
          chunkIndex: chunks.length,
          totalChunks: 0, // Will update after
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
 * Chunk statute by paragraph boundaries with overlap
 */
function chunkByParagraphs(
  section: TexasStatuteSection,
  context: TexasChunkContext
): TexasChunk[] {
  const textChunks = splitWithOverlap(section.text, MAX_CHUNK_TOKENS, OVERLAP_RATIO);

  return textChunks.map((text, index) => ({
    chunkId: generateTexasChunkId('statute', context.code, context.chapter, section.section, index),
    sourceId: generateTexasSourceId('statute', context.code),
    sourceType: 'tx-statute',
    text,
    citation: generateTexasStatuteCitation(context.code, section.section),
    url: generateStatuteUrl(context.code, section.section),
    code: context.code,
    chapter: context.chapter,
    section: section.section,
    hierarchy: generateTexasHierarchy('statute', context.codeName, context.chapter, section.section),
    category: context.category,
    chunkIndex: index,
    totalChunks: textChunks.length,
  }));
}

/**
 * Chunk TAC rule by paragraph boundaries with overlap
 */
function chunkTACByParagraphs(rule: TACRule, context: TACChunkContext): TexasChunk[] {
  const textChunks = splitWithOverlap(rule.text, MAX_CHUNK_TOKENS, OVERLAP_RATIO);

  return textChunks.map((text, index) => ({
    chunkId: generateTexasChunkId('tac', context.title, context.chapter, rule.section, index),
    sourceId: generateTexasSourceId('tac', context.title),
    sourceType: 'tx-tac',
    text,
    citation: generateTACCitation(context.title, rule.section),
    url: generateTACUrl(context.title, context.chapter, rule.section),
    tacTitle: context.title,
    chapter: context.chapter,
    section: rule.section,
    hierarchy: generateTexasHierarchy('tac', `Title ${context.title}: ${context.titleName}`, context.chapter, rule.section),
    category: context.category,
    chunkIndex: index,
    totalChunks: textChunks.length,
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
function getOverlapText(chunk: string[], targetTokens: number): string {
  if (chunk.length === 0) return '';

  // Work backwards from end of chunk
  let overlapParagraphs: string[] = [];
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
 * Batch chunk entire Texas code
 *
 * Processes all sections in a code and returns flat array of chunks.
 *
 * @param sections Array of Texas statute sections
 * @param codeConfig Code configuration
 * @returns Flat array of all chunks
 *
 * @example
 * ```typescript
 * const sections = await fetchTexasCode('PE');
 * const codeConfig = {
 *   abbreviation: 'PE',
 *   name: 'Penal Code',
 *   categories: ['criminal'],
 *   enabled: true
 * };
 * const chunks = chunkTexasCode(sections, codeConfig);
 * console.log(`Created ${chunks.length} chunks`);
 * ```
 */
export function chunkTexasCode(
  sections: TexasStatuteSection[],
  codeConfig: TexasCodeConfig
): TexasChunk[] {
  const allChunks: TexasChunk[] = [];

  for (const section of sections) {
    const context: TexasChunkContext = {
      code: codeConfig.abbreviation,
      codeName: codeConfig.name,
      chapter: section.chapter,
      category: codeConfig.categories[0] ?? undefined, // Use primary category
    };

    const chunks = chunkTexasStatute(section, context);
    allChunks.push(...chunks);
  }

  return allChunks;
}

/**
 * Batch chunk entire TAC title
 *
 * Processes all rules in a title and returns flat array of chunks.
 *
 * @param rules Array of TAC rules
 * @param titleConfig TAC title configuration
 * @returns Flat array of all chunks
 *
 * @example
 * ```typescript
 * const rules: TACRule[] = [];
 * for await (const rule of fetchTACTitle(titleConfig)) {
 *   rules.push(rule);
 * }
 * const chunks = chunkTACTitle(rules, titleConfig);
 * console.log(`Created ${chunks.length} chunks`);
 * ```
 */
export function chunkTACTitle(
  rules: TACRule[],
  titleConfig: TACTitleConfig
): TexasChunk[] {
  const allChunks: TexasChunk[] = [];

  for (const rule of rules) {
    const context: TACChunkContext = {
      title: titleConfig.number,
      titleName: titleConfig.name,
      chapter: rule.chapter,
      category: titleConfig.categories[0] ?? undefined, // Use primary category
    };

    const chunks = chunkTACRule(rule, context);
    allChunks.push(...chunks);
  }

  return allChunks;
}

/**
 * Calculate chunk statistics
 *
 * Useful for monitoring chunk quality and distribution.
 *
 * @param chunks Array of Texas chunks
 * @returns Statistics object
 *
 * @example
 * ```typescript
 * const stats = getTexasChunkStats(chunks);
 * console.log(`Total: ${stats.totalChunks}, Avg: ${stats.avgTokens}, Max: ${stats.maxTokens}`);
 * ```
 */
export function getTexasChunkStats(chunks: TexasChunk[]): {
  totalChunks: number;
  avgTokens: number;
  maxTokens: number;
  minTokens: number;
} {
  if (chunks.length === 0) {
    return { totalChunks: 0, avgTokens: 0, maxTokens: 0, minTokens: 0 };
  }

  const tokenCounts = chunks.map(chunk => countTokens(chunk.text));
  const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0);

  return {
    totalChunks: chunks.length,
    avgTokens: Math.round(totalTokens / chunks.length),
    maxTokens: Math.max(...tokenCounts),
    minTokens: Math.min(...tokenCounts),
  };
}
