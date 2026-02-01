/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  // R2 bucket for storing compliance documents
  DOCUMENTS_BUCKET: R2Bucket;

  // API keys (secrets, not in wrangler.jsonc)
  OPENAI_API_KEY: string;
  PINECONE_API_KEY: string;

  // Convex URL for syncing freshness data
  CONVEX_URL: string;
}
