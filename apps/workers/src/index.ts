import type { Env } from './types';

/**
 * Cloudflare Worker for ComplianceIQ data pipeline
 *
 * Handles:
 * - Document storage via R2
 * - Future: Scraping workers
 * - Future: Embedding workers
 * - Future: Indexing workers
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          worker: 'compliance-iq-workers'
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // List documents in R2 bucket (for verification)
    if (url.pathname === '/documents') {
      try {
        const listed = await env.DOCUMENTS_BUCKET.list({ limit: 10 });
        return new Response(
          JSON.stringify({
            truncated: listed.truncated,
            count: listed.objects.length,
            objects: listed.objects.map(obj => ({
              key: obj.key,
              size: obj.size,
              uploaded: obj.uploaded,
            })),
          }),
          {
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: 'Failed to list documents',
            message: error instanceof Error ? error.message : 'Unknown error'
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Default 404 response
    return new Response('Not found', { status: 404 });
  },
};
