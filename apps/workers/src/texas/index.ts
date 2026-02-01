/**
 * Texas State Data Pipeline Module
 *
 * Provides scraping, parsing, storage, and processing for Texas Statutes
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

// Storage and checkpointing
export {
  storeTexasStatute,
  getTexasStatute,
  listTexasStatuteSections,
  saveTexasCheckpoint,
  loadTexasCheckpoint,
  clearTexasCheckpoint,
  storeTACRule,
  getTACRule,
} from './storage';

// Pipeline orchestrator
export {
  processTexasCode,
  processTexasTACTitle,
  processTexasStatutes,
  processTexasTAC,
  processAllTexasSources,
  type TexasPipelineResult,
  type TexasBatchPipelineResult,
} from './pipeline';
