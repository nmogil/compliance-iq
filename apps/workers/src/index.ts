import type { Env } from './types';
import { processCFRTitle, processAllFederalTitles } from './federal';
import {
  processTexasStatutes,
  processTexasTAC,
  processAllTexasSources,
  processTexasCode,
  processTexasTACTitle,
} from './texas/pipeline';
import { TARGET_STATUTES, TARGET_TAC_TITLES } from './texas/types';
import {
  processAllCounties,
  processCounty,
  getEnabledCounties,
  getSkippedCounties,
  getCountyByName,
  validateCountySources,
} from './counties';

/**
 * Cloudflare Worker for ComplianceIQ data pipeline
 *
 * Handles:
 * - Document storage via R2
 * - Federal CFR data pipeline
 * - Texas state data pipeline (statutes + TAC)
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
            'POST /pipeline/federal/:title - Trigger single CFR title pipeline',
            'POST /pipeline/texas - Trigger full Texas pipeline (statutes + TAC)',
            'POST /pipeline/texas/statutes - Trigger Texas Statutes pipeline (27 codes)',
            'POST /pipeline/texas/tac - Trigger Texas TAC pipeline (5 titles)',
            'POST /pipeline/texas/statutes/:code - Trigger single statute code pipeline',
            'POST /pipeline/texas/tac/:title - Trigger single TAC title pipeline',
            'POST /pipeline/counties - Trigger county pipeline (10 Texas counties)',
            'POST /pipeline/counties/:county - Trigger single county pipeline',
            'GET /pipeline/counties/status - Get county coverage status',
            'POST /pipeline/counties/validate - Validate county sources',
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

    // POST /pipeline/texas - Trigger full Texas pipeline
    if (url.pathname === '/pipeline/texas' && request.method === 'POST') {
      try {
        console.log('[Worker] Starting full Texas pipeline');
        const result = await processAllTexasSources(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Texas pipeline failed:', error);
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

    // POST /pipeline/texas/statutes - Trigger Texas Statutes only
    if (url.pathname === '/pipeline/texas/statutes' && request.method === 'POST') {
      try {
        console.log('[Worker] Starting Texas Statutes pipeline');
        const result = await processTexasStatutes(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Texas Statutes pipeline failed:', error);
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

    // POST /pipeline/texas/tac - Trigger Texas TAC only
    if (url.pathname === '/pipeline/texas/tac' && request.method === 'POST') {
      try {
        console.log('[Worker] Starting Texas TAC pipeline');
        const result = await processTexasTAC(env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Texas TAC pipeline failed:', error);
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

    // POST /pipeline/texas/statutes/:code - Trigger single statute code
    const statuteMatch = url.pathname.match(/^\/pipeline\/texas\/statutes\/([A-Z]{2})$/);
    if (statuteMatch && statuteMatch[1] && request.method === 'POST') {
      const code = statuteMatch[1];
      const codeConfig = TARGET_STATUTES.find(c => c.abbreviation === code);

      if (!codeConfig) {
        return new Response(
          JSON.stringify({ error: `Unknown code: ${code}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        console.log(`[Worker] Starting pipeline for Texas ${code}`);
        const result = await processTexasCode(codeConfig, env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error(`[Worker] Pipeline failed for ${code}:`, error);
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

    // POST /pipeline/texas/tac/:title - Trigger single TAC title
    const tacMatch = url.pathname.match(/^\/pipeline\/texas\/tac\/(\d+)$/);
    if (tacMatch && tacMatch[1] && request.method === 'POST') {
      const titleNumber = parseInt(tacMatch[1], 10);
      const titleConfig = TARGET_TAC_TITLES.find(t => t.number === titleNumber);

      if (!titleConfig) {
        return new Response(
          JSON.stringify({ error: `Unknown TAC title: ${titleNumber}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        console.log(`[Worker] Starting pipeline for TAC Title ${titleNumber}`);
        const result = await processTexasTACTitle(titleConfig, env);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error(`[Worker] Pipeline failed for TAC Title ${titleNumber}:`, error);
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

    // POST /pipeline/counties - Trigger full county pipeline (10 Texas counties)
    if (url.pathname === '/pipeline/counties' && request.method === 'POST') {
      try {
        console.log('[Worker] Starting full county pipeline');
        const result = await processAllCounties(env);
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 207, // 207 Multi-Status if partial success
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] County pipeline failed:', error);
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

    // GET /pipeline/counties/status - Get county coverage status
    if (url.pathname === '/pipeline/counties/status' && request.method === 'GET') {
      const enabled = getEnabledCounties();
      const skipped = getSkippedCounties();

      const status = {
        totalCounties: 10,
        enabledCount: enabled.length,
        skippedCount: skipped.length,
        enabled: enabled.map((c) => ({
          name: c.name,
          fipsCode: c.fipsCode,
          platform: c.platform,
          categories: c.categories,
        })),
        skipped: skipped.map((c) => ({
          name: c.name,
          fipsCode: c.fipsCode,
          reason: c.skipReason,
        })),
      };

      return new Response(JSON.stringify(status, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // POST /pipeline/counties/validate - Validate all county sources
    if (url.pathname === '/pipeline/counties/validate' && request.method === 'POST') {
      try {
        console.log('[Worker] Validating county sources');
        const result = await validateCountySources();

        return new Response(
          JSON.stringify(
            {
              validCount: result.valid.length,
              invalidCount: result.invalid.length,
              valid: result.valid,
              invalid: result.invalid,
            },
            null,
            2
          ),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch (error) {
        console.error('[Worker] County validation failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Validation failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // POST /pipeline/counties/:county - Trigger single county pipeline
    const countyMatch = url.pathname.match(/^\/pipeline\/counties\/([a-z-]+)$/i);
    if (countyMatch && countyMatch[1] && request.method === 'POST') {
      const countyName = countyMatch[1].replace(/-/g, ' '); // Handle "fort-bend" -> "Fort Bend"
      const countyConfig = getCountyByName(countyName);

      if (!countyConfig) {
        return new Response(
          JSON.stringify({ error: `Unknown county: ${countyName}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        console.log(`[Worker] Starting pipeline for ${countyConfig.name} County`);
        const result = await processCounty(countyConfig, env);
        return new Response(JSON.stringify(result), {
          status: result.success ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error(`[Worker] Pipeline failed for ${countyConfig.name} County:`, error);
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
