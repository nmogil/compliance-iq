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
export { CountyAdapterBase, loadCheerioPage } from './adapters/base';
export { MunicodeAdapter } from './adapters/municode';

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
