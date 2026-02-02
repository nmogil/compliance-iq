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
}
