/**
 * Texas State Data Pipeline Module
 *
 * Provides scraping, parsing, and processing for Texas Statutes
 * and Texas Administrative Code (TAC).
 */

// Types
export * from './types';

// Statute fetcher and parser
export { fetchTexasStatute, fetchTexasCode, discoverCodeChapters } from './fetch-statutes';
export { parseStatuteHTML, extractSectionText } from './parse-statutes';

// TAC fetcher and parser
export { fetchTACRule, fetchTACTitle, fetchTACHTML, discoverTACChapters, discoverChapterRules } from './fetch-tac';
export { parseTACHTML, extractTACRuleText, extractTACRuleHeading } from './parse-tac';

// Chunking
export {
  chunkTexasStatute,
  chunkTACRule,
  chunkTexasCode,
  chunkTACTitle,
  splitWithOverlap,
  getTexasChunkStats,
  type TexasChunkContext,
  type TACChunkContext,
} from './chunk';

// Future: Storage (03-04)
// export { storeTexasStatute, saveTexasCheckpoint } from './storage';

// Future: Pipeline orchestrator (03-06)
// export { processTexasStatutes, processAllTexasSources } from './pipeline';
