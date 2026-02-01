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

// Future: TAC fetcher and parser (03-05)
// export { fetchTACRule, fetchTACTitle } from './fetch-tac';
// export { parseTACHTML } from './parse-tac';

// Future: Storage and chunking (03-04)
// export { storeTexasStatute, saveTexasCheckpoint } from './storage';
// export { chunkTexasStatute } from './chunk';

// Future: Pipeline orchestrator (03-06)
// export { processTexasStatutes, processAllTexasSources } from './pipeline';
