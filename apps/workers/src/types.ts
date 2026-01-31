/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  // R2 bucket for storing compliance documents
  DOCUMENTS_BUCKET: R2Bucket;
}
