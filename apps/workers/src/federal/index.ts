/**
 * Federal CFR Data Pipeline
 *
 * Public API for federal regulations processing.
 * Barrel export for all federal pipeline modules.
 */

// Types
export { TARGET_TITLES, type CFRTitleConfig, type CFRChunk, type CFRPart, type CFRSection } from './types';

// Fetch
export { fetchCFRTitle, fetchCFRPart, parseCFRXML } from './fetch';

// Storage
export { storeCFRPart, saveCheckpoint, loadCheckpoint, clearCheckpoint } from './storage';

// Chunking
export { chunkCFRSection, chunkCFRPart } from './chunk';

// Embedding
export { embedChunks, generateEmbeddings } from './embed';

// Cache (pre-processed CFR data for workflows)
export {
  getCacheManifest,
  getTitleManifest,
  getCachedPart,
  getCacheStatus,
  refreshCFRCache,
  refreshCFRTitle,
  computeXMLHash,
  isCacheValid,
} from './cache';
export type {
  CachedCFRPart,
  CacheManifest,
  TitleManifest,
  CacheRefreshResult,
  TitleRefreshResult,
} from './cache';

// Pipeline orchestration
export { processCFRTitle, processAllFederalTitles } from './pipeline';
export type { PipelineResult, BatchPipelineResult } from './pipeline';
