/**
 * Municipal Data Pipeline Module
 *
 * Exports all municipal types, city registry, and utility functions.
 * Use Firecrawl for scraping both Municode and American Legal platforms.
 *
 * Key Exports:
 * - Types: MunicipalOrdinance, MunicipalChunk, MunicipalCityConfig, MunicipalCheckpoint, MunicipalBatchResult
 * - Cities: TEXAS_CITIES, getEnabledCities, getCityById, getCityByName
 * - Storage: storeMunicipalOrdinance, saveMunicipalCheckpoint, getMunicipalMarkdown
 * - Scraper: scrapeMunicipalCode, scrapeCity, scrapeAllCities
 * - Parser: parseMarkdownToOrdinances, extractSections, validateOrdinances
 * - Chunk: chunkMunicipalOrdinance, chunkCity, getMunicipalChunkStats
 * - Fetch: fetchCity, fetchAllEnabledCities, fetchSingleCity
 * - Pipeline: processCity, processAllCities, processSingleCity, getMunicipalPipelineStatus
 */

// Type definitions
export * from './types';

// City registry and helpers
export * from './cities';

// Storage operations (R2, checkpoints, markdown cache)
export * from './storage';

// Firecrawl scraper
export * from './scraper';

// Markdown parser
export * from './parser';

// Chunking for embeddings
export * from './chunk';

// Fetch orchestrator
export {
  fetchCity,
  fetchAllEnabledCities,
  fetchSingleCity,
  getFetchStats,
  type CityFetchResult,
  type Env as FetchEnv,
} from './fetch';

// Pipeline orchestrator
export {
  processCity,
  processAllCities,
  processSingleCity,
  getMunicipalPipelineStatus,
  resetMunicipalPipeline,
  type MunicipalPipelineResult,
  type MunicipalBatchPipelineResult,
  type Env as PipelineEnv,
} from './pipeline';
