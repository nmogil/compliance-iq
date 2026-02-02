/**
 * County Data Pipeline Module
 *
 * Exports types, source registry, and utilities for Texas county
 * ordinance data processing.
 */

// Types
export type {
  CountySubsection,
  CountyOrdinance,
  CourtOrder,
  CountyPlatform,
  CountySourceConfig,
  CountyChunk,
  CountyCheckpoint,
  CountyAdapter,
} from './types';

// Source registry
export {
  TARGET_COUNTIES,
  getEnabledCounties,
  getSkippedCounties,
  getCountyByName,
  getCountyByFips,
  getCountiesByPlatform,
  getCoverageStats,
} from './sources';

// Adapters
export {
  CountyAdapterBase,
  loadCheerioPage,
  MunicodeAdapter,
  ElawsAdapter,
  AmlegalAdapter,
  getAdapterForCounty,
  getAdaptersForEnabledCounties,
  validateAllCountySources,
  getAdapterStats,
} from './adapters';

// Storage
export {
  storeCountyOrdinance,
  getCountyOrdinance,
  listCountyOrdinances,
  saveCountyCheckpoint,
  loadCountyCheckpoint,
  clearCountyCheckpoint,
  getCountyStorageStats,
} from './storage';

// Chunking
export {
  chunkCountyOrdinance,
  chunkCounty,
  getCountyChunkStats,
  splitWithOverlap,
  getOverlapText,
} from './chunk';
export type { CountyChunkContext } from './chunk';

// Fetch orchestrator
export {
  fetchCountyOrdinances,
  fetchAllEnabledCounties,
  validateCountySources,
  getFetchStats,
} from './fetch';
export type { CountyFetchResult, AllCountiesFetchResult } from './fetch';
