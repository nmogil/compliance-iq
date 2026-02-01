import type { Env } from './types';
import { processCFRTitle, processAllFederalTitles } from './federal';

/**
 * Cloudflare Worker for ComplianceIQ data pipeline
 *
 * Handles:
 * - Document storage via R2
 * - Federal CFR data pipeline
 * - Future: State regulations pipeline
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
          worker: 'compliance-iq-workers',
          endpoints: [
            'GET /health - Health check',
            'GET /documents - List R2 documents',
            'POST /pipeline/federal - Trigger full federal pipeline (7 titles)',
            'POST /pipeline/federal/:title - Trigger single title pipeline',
          ],
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
            objects: listed.objects.map((obj) => ({
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
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // POST /pipeline/federal - Trigger full federal data pipeline
    if (url.pathname === '/pipeline/federal' && request.method === 'POST') {
      try {
        console.log('[Worker] Starting full federal pipeline');
        const result = await processAllFederalTitles(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Pipeline failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Pipeline failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // POST /pipeline/federal/:title - Trigger single title pipeline
    const titleMatch = url.pathname.match(/^\/pipeline\/federal\/(\d+)$/);
    if (titleMatch && titleMatch[1] && request.method === 'POST') {
      const titleNumber = parseInt(titleMatch[1], 10);
      try {
        console.log(`[Worker] Starting pipeline for title ${titleNumber}`);
        const result = await processCFRTitle(titleNumber, env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error(`[Worker] Pipeline failed for title ${titleNumber}:`, error);
        return new Response(
          JSON.stringify({
            error: 'Pipeline failed',
            message: error instanceof Error ? error.message : 'Unknown error',
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
