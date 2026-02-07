import type {
  Workflow,
  FederalBatchParams,
  FederalTitleParams,
  TexasBatchParams,
  TexasCodeParams,
  TexasTACParams,
  CountyBatchParams,
  CountyProcessorParams,
  MunicipalBatchParams,
  CityProcessorParams,
} from './workflows/types';

/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  // R2 bucket for storing compliance documents
  // Note: Some modules use DOCUMENTS_BUCKET, municipal uses R2_BUCKET
  DOCUMENTS_BUCKET: R2Bucket;

  // Alias for R2 bucket (used by municipal module for consistency)
  R2_BUCKET: R2Bucket;

  // API keys (secrets, not in wrangler.jsonc)
  OPENAI_API_KEY: string;
  PINECONE_API_KEY: string;

  // Firecrawl API key for municipal scraping
  FIRECRAWL_API_KEY: string;

  // Convex URL for syncing freshness data
  CONVEX_URL: string;

  // Feature flag for workflows (set to 'false' to use legacy synchronous processing)
  FEATURE_WORKFLOWS?: string;

  // Workflow bindings for durable execution
  // Federal CFR pipeline
  FEDERAL_BATCH_WORKFLOW: Workflow<FederalBatchParams>;
  FEDERAL_TITLE_WORKFLOW: Workflow<FederalTitleParams>;

  // Texas state pipeline
  TEXAS_BATCH_WORKFLOW: Workflow<TexasBatchParams>;
  TEXAS_CODE_WORKFLOW: Workflow<TexasCodeParams>;
  TEXAS_TAC_WORKFLOW: Workflow<TexasTACParams>;

  // County pipeline
  COUNTY_BATCH_WORKFLOW: Workflow<CountyBatchParams>;
  COUNTY_PROCESSOR_WORKFLOW: Workflow<CountyProcessorParams>;

  // Municipal pipeline
  MUNICIPAL_BATCH_WORKFLOW: Workflow<MunicipalBatchParams>;
  CITY_PROCESSOR_WORKFLOW: Workflow<CityProcessorParams>;
}
