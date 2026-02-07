import type { Env } from './types';
// Import lightweight modules directly
import { TARGET_TITLES } from './federal/types';
import {
  getCacheStatus,
  refreshCFRCache,
  refreshCFRTitle as refreshCFRTitleCache,
} from './federal/cache';
// Note: processCFRTitle and processAllFederalTitles are dynamically imported
// to avoid loading heavy dependencies (tiktoken, OpenAI SDK) at startup
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
import {
  processAllCities,
  processSingleCity,
  getMunicipalPipelineStatus,
  resetMunicipalPipeline,
  getEnabledCities,
  getSkippedCities,
  getCityByName,
  getCityById,
} from './municipal';
import {
  checkCoverage,
  generateFullValidationReport,
  formatValidationResultMarkdown,
} from './validation';
import type { WorkflowTriggerResponse, WorkflowStatusResponse } from './workflows/types';

// Re-export workflow classes for Cloudflare binding
export { FederalBatchWorkflow } from './workflows/federal/batch.workflow';
export { FederalTitleWorkflow } from './workflows/federal/title.workflow';
export { TexasBatchWorkflow } from './workflows/texas/batch.workflow';
export { TexasCodeWorkflow } from './workflows/texas/code.workflow';
export { TexasTACWorkflow } from './workflows/texas/tac.workflow';
export { CountyBatchWorkflow } from './workflows/counties/batch.workflow';
export { CountyProcessorWorkflow } from './workflows/counties/county.workflow';
export { MunicipalBatchWorkflow } from './workflows/municipal/batch.workflow';
export { CityProcessorWorkflow } from './workflows/municipal/city.workflow';

/**
 * Check if workflows feature is enabled
 */
function useWorkflows(env: Env): boolean {
  return env.FEATURE_WORKFLOWS !== 'false';
}

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
      const workflowsEnabled = useWorkflows(env);
      return new Response(
        JSON.stringify({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          worker: 'compliance-iq-workers',
          workflowsEnabled,
          endpoints: [
            'GET /health - Health check',
            'GET /documents - List R2 documents',
            // Cache endpoints (pre-process CFR data for workflows)
            'GET /cache/federal/status - Get cache manifest and freshness info',
            'POST /cache/federal/refresh - Refresh cache for all 7 CFR titles',
            'POST /cache/federal/refresh/:title - Refresh cache for single title',
            // Pipeline endpoints (now async when workflows enabled)
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
            'POST /pipeline/municipal - Trigger municipal pipeline (20 Texas cities)',
            'POST /pipeline/municipal/:city - Trigger single city pipeline',
            'GET /pipeline/municipal/status - Get municipal pipeline status',
            'POST /pipeline/municipal/reset - Reset municipal pipeline checkpoint',
            // Workflow management endpoints (new)
            'GET /workflows/:id/status - Get workflow status and progress',
            'POST /workflows/:id/pause - Pause running workflow',
            'POST /workflows/:id/resume - Resume paused workflow',
            'POST /workflows/:id/cancel - Terminate workflow',
            // Validation endpoints
            'GET /validation/coverage - Get coverage report for all jurisdictions',
            'GET /validation/quality - Get data quality validation report (JSON)',
            'GET /validation/report - Get data quality validation report (Markdown)',
            'GET /validation/summary - Get quick validation summary',
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

    // =========================================================================
    // Cache Endpoints (Pre-process CFR data for workflows)
    // =========================================================================

    // GET /cache/federal/status - Get cache status and freshness info
    if (url.pathname === '/cache/federal/status' && request.method === 'GET') {
      try {
        console.log('[Worker] Getting cache status');
        const status = await getCacheStatus(env.DOCUMENTS_BUCKET);

        return new Response(JSON.stringify(status, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Cache status check failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Cache status check failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // POST /cache/federal/refresh - Refresh cache for all titles
    if (url.pathname === '/cache/federal/refresh' && request.method === 'POST') {
      try {
        console.log('[Worker] Starting full cache refresh');
        const result = await refreshCFRCache(env.DOCUMENTS_BUCKET);

        return new Response(JSON.stringify(result, null, 2), {
          status: result.success ? 200 : 207,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Cache refresh failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Cache refresh failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // POST /cache/federal/refresh/:title - Refresh cache for single title
    const cacheRefreshMatch = url.pathname.match(/^\/cache\/federal\/refresh\/(\d+)$/);
    if (cacheRefreshMatch && cacheRefreshMatch[1] && request.method === 'POST') {
      const titleNumber = parseInt(cacheRefreshMatch[1], 10);
      try {
        console.log(`[Worker] Refreshing cache for title ${titleNumber}`);
        const result = await refreshCFRTitleCache(env.DOCUMENTS_BUCKET, titleNumber);

        return new Response(JSON.stringify(result, null, 2), {
          status: result.success ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error(`[Worker] Cache refresh failed for title ${titleNumber}:`, error);
        return new Response(
          JSON.stringify({
            error: 'Cache refresh failed',
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

        // Use workflows if enabled
        if (useWorkflows(env)) {
          const instance = await env.FEDERAL_BATCH_WORKFLOW.create({
            params: {},
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'federal-batch',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Legacy synchronous processing (dynamically import to avoid loading tiktoken at startup)
        const { processAllFederalTitles } = await import('./federal/pipeline');
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

        // Use workflows if enabled
        if (useWorkflows(env)) {
          // Validate title number
          const titleConfig = TARGET_TITLES.find((t) => t.number === titleNumber);
          if (!titleConfig) {
            return new Response(
              JSON.stringify({ error: `Unknown CFR title: ${titleNumber}` }),
              { status: 400, headers: { 'Content-Type': 'application/json' } }
            );
          }

          const instance = await env.FEDERAL_TITLE_WORKFLOW.create({
            params: { titleNumber },
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'federal-title',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Legacy synchronous processing (dynamically import to avoid loading tiktoken at startup)
        const { processCFRTitle } = await import('./federal/pipeline');
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

        if (useWorkflows(env)) {
          const instance = await env.TEXAS_BATCH_WORKFLOW.create({
            params: {},
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'texas-batch',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

        if (useWorkflows(env)) {
          const instance = await env.TEXAS_BATCH_WORKFLOW.create({
            params: { statutesOnly: true },
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'texas-batch',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

        if (useWorkflows(env)) {
          const instance = await env.TEXAS_BATCH_WORKFLOW.create({
            params: { tacOnly: true },
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'texas-batch',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

        if (useWorkflows(env)) {
          const instance = await env.TEXAS_CODE_WORKFLOW.create({
            params: { codeAbbreviation: code },
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'texas-code',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

        if (useWorkflows(env)) {
          const instance = await env.TEXAS_TAC_WORKFLOW.create({
            params: { tacTitleNumber: titleNumber },
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'texas-tac',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

        if (useWorkflows(env)) {
          const instance = await env.COUNTY_BATCH_WORKFLOW.create({
            params: {},
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'county-batch',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

        if (useWorkflows(env)) {
          const instance = await env.COUNTY_PROCESSOR_WORKFLOW.create({
            params: {
              countyName: countyConfig.name,
              fipsCode: countyConfig.fipsCode,
            },
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'county-processor',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

    // =========================================================================
    // Municipal Pipeline Endpoints
    // =========================================================================

    // POST /pipeline/municipal - Trigger full municipal pipeline (20 Texas cities)
    if (url.pathname === '/pipeline/municipal' && request.method === 'POST') {
      try {
        console.log('[Worker] Starting full municipal pipeline');

        if (useWorkflows(env)) {
          const instance = await env.MUNICIPAL_BATCH_WORKFLOW.create({
            params: {},
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'municipal-batch',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await processAllCities(env, { resumeFromCheckpoint: true });
        return new Response(JSON.stringify(result), {
          status: result.failed.length === 0 ? 200 : 207, // 207 Multi-Status if partial success
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Municipal pipeline failed:', error);
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

    // GET /pipeline/municipal/status - Get municipal pipeline status and storage stats
    if (url.pathname === '/pipeline/municipal/status' && request.method === 'GET') {
      try {
        const status = await getMunicipalPipelineStatus(env);
        const enabled = getEnabledCities();
        const skipped = getSkippedCities();

        return new Response(
          JSON.stringify(
            {
              totalCities: 20,
              enabledCount: enabled.length,
              skippedCount: skipped.length,
              checkpoint: status.checkpoint,
              storage: status.storage,
              enabled: enabled.map((c) => ({
                name: c.name,
                cityId: c.cityId,
                platform: c.platform,
              })),
              skipped: skipped.map((c) => ({
                name: c.name,
                cityId: c.cityId,
                reason: c.skipReason,
              })),
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
        console.error('[Worker] Municipal status check failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Status check failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // POST /pipeline/municipal/reset - Clear checkpoint for fresh run
    if (url.pathname === '/pipeline/municipal/reset' && request.method === 'POST') {
      try {
        console.log('[Worker] Resetting municipal pipeline checkpoint');
        await resetMunicipalPipeline(env);
        return new Response(
          JSON.stringify({ success: true, message: 'Municipal checkpoint cleared' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      } catch (error) {
        console.error('[Worker] Municipal reset failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Reset failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // POST /pipeline/municipal/:city - Trigger single city pipeline
    const cityMatch = url.pathname.match(/^\/pipeline\/municipal\/([a-z_]+)$/i);
    if (cityMatch && cityMatch[1] && request.method === 'POST') {
      const cityIdOrName = cityMatch[1].replace(/_/g, '_'); // Keep underscores for cityId lookup
      const city = getCityById(cityIdOrName) ?? getCityByName(cityIdOrName.replace(/_/g, ' '));

      if (!city) {
        return new Response(
          JSON.stringify({ error: `Unknown city: ${cityIdOrName}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (!city.enabled) {
        return new Response(
          JSON.stringify({
            error: `City is disabled: ${city.name}`,
            reason: city.skipReason ?? 'No reason given',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        console.log(`[Worker] Starting pipeline for ${city.name}`);

        if (useWorkflows(env)) {
          const instance = await env.CITY_PROCESSOR_WORKFLOW.create({
            params: { cityId: city.cityId },
          });

          const response: WorkflowTriggerResponse = {
            instanceId: instance.id,
            workflowType: 'city-processor',
            status: 'queued',
            statusUrl: `/workflows/${instance.id}/status`,
            triggeredAt: new Date().toISOString(),
          };

          return new Response(JSON.stringify(response), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await processSingleCity(env, city.cityId);
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error(`[Worker] Pipeline failed for ${city.name}:`, error);
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

    // =========================================================================
    // Validation Endpoints
    // =========================================================================

    // GET /validation/coverage - Coverage report for all jurisdictions
    if (url.pathname === '/validation/coverage' && request.method === 'GET') {
      if (!env.PINECONE_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'PINECONE_API_KEY not configured' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        console.log('[Worker] Generating coverage report');
        const startTime = Date.now();

        const { Pinecone } = await import('@pinecone-database/pinecone');
        const pinecone = new Pinecone({ apiKey: env.PINECONE_API_KEY });
        const index = pinecone.index('compliance-embeddings');

        const coverageReport = await checkCoverage(index as any);
        const duration = Date.now() - startTime;

        console.log(`[Worker] Coverage report generated in ${duration}ms`);

        return new Response(JSON.stringify(coverageReport, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Coverage report failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Coverage report failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // GET /validation/quality - Quality validation report (JSON)
    if (url.pathname === '/validation/quality' && request.method === 'GET') {
      if (!env.PINECONE_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'PINECONE_API_KEY not configured' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        console.log('[Worker] Generating quality validation report');
        const startTime = Date.now();

        const { Pinecone } = await import('@pinecone-database/pinecone');
        const pinecone = new Pinecone({ apiKey: env.PINECONE_API_KEY });
        const index = pinecone.index('compliance-embeddings');

        const validationResult = await generateFullValidationReport(index as any);
        const duration = Date.now() - startTime;

        console.log(`[Worker] Quality validation completed in ${duration}ms`);

        return new Response(JSON.stringify(validationResult, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Quality validation failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Quality validation failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // GET /validation/report - Quality validation report (Markdown)
    if (url.pathname === '/validation/report' && request.method === 'GET') {
      if (!env.PINECONE_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'PINECONE_API_KEY not configured' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        console.log('[Worker] Generating markdown validation report');
        const startTime = Date.now();

        const { Pinecone } = await import('@pinecone-database/pinecone');
        const pinecone = new Pinecone({ apiKey: env.PINECONE_API_KEY });
        const index = pinecone.index('compliance-embeddings');

        const validationResult = await generateFullValidationReport(index as any);
        const markdown = formatValidationResultMarkdown(validationResult);
        const duration = Date.now() - startTime;

        console.log(`[Worker] Markdown report generated in ${duration}ms`);

        return new Response(markdown, {
          status: 200,
          headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        });
      } catch (error) {
        console.error('[Worker] Markdown report failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Markdown report failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // GET /validation/summary - Quick validation summary
    if (url.pathname === '/validation/summary' && request.method === 'GET') {
      if (!env.PINECONE_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'PINECONE_API_KEY not configured' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      try {
        console.log('[Worker] Generating validation summary');
        const startTime = Date.now();

        const { Pinecone } = await import('@pinecone-database/pinecone');
        const pinecone = new Pinecone({ apiKey: env.PINECONE_API_KEY });
        const index = pinecone.index('compliance-embeddings');

        // Run both coverage and quality reports
        const [coverageReport, validationResult] = await Promise.all([
          checkCoverage(index as any),
          generateFullValidationReport(index as any),
        ]);

        const duration = Date.now() - startTime;

        const summary = {
          timestamp: new Date().toISOString(),
          coveragePercent: coverageReport.coveragePercent,
          totalChunks: validationResult.summary.totalChunks,
          avgTokens: validationResult.summary.avgTokens,
          issuesCount: validationResult.summary.issuesCount,
          durationMs: duration,
        };

        console.log(`[Worker] Summary generated in ${duration}ms`);

        return new Response(JSON.stringify(summary, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('[Worker] Summary generation failed:', error);
        return new Response(
          JSON.stringify({
            error: 'Summary generation failed',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // =========================================================================
    // Workflow Management Endpoints
    // =========================================================================

    // GET /workflows/:id/status - Get workflow status
    const workflowStatusMatch = url.pathname.match(/^\/workflows\/([a-f0-9-]+)\/status$/i);
    if (workflowStatusMatch && workflowStatusMatch[1] && request.method === 'GET') {
      const instanceId = workflowStatusMatch[1];

      try {
        // Try to get status from each workflow type (we don't know which type it is)
        // This is a limitation - in production you'd store workflow type mapping
        let status: any = null;
        let workflowType = 'unknown';

        // Try federal workflows first
        try {
          const instance = await env.FEDERAL_BATCH_WORKFLOW.get(instanceId);
          status = await instance.status();
          workflowType = 'federal-batch';
        } catch {
          try {
            const instance = await env.FEDERAL_TITLE_WORKFLOW.get(instanceId);
            status = await instance.status();
            workflowType = 'federal-title';
          } catch {
            // Continue trying other workflow types
          }
        }

        // Try Texas workflows
        if (!status) {
          try {
            const instance = await env.TEXAS_BATCH_WORKFLOW.get(instanceId);
            status = await instance.status();
            workflowType = 'texas-batch';
          } catch {
            try {
              const instance = await env.TEXAS_CODE_WORKFLOW.get(instanceId);
              status = await instance.status();
              workflowType = 'texas-code';
            } catch {
              try {
                const instance = await env.TEXAS_TAC_WORKFLOW.get(instanceId);
                status = await instance.status();
                workflowType = 'texas-tac';
              } catch {
                // Continue trying other workflow types
              }
            }
          }
        }

        // Try county workflows
        if (!status) {
          try {
            const instance = await env.COUNTY_BATCH_WORKFLOW.get(instanceId);
            status = await instance.status();
            workflowType = 'county-batch';
          } catch {
            try {
              const instance = await env.COUNTY_PROCESSOR_WORKFLOW.get(instanceId);
              status = await instance.status();
              workflowType = 'county-processor';
            } catch {
              // Continue trying other workflow types
            }
          }
        }

        // Try municipal workflows
        if (!status) {
          try {
            const instance = await env.MUNICIPAL_BATCH_WORKFLOW.get(instanceId);
            status = await instance.status();
            workflowType = 'municipal-batch';
          } catch {
            try {
              const instance = await env.CITY_PROCESSOR_WORKFLOW.get(instanceId);
              status = await instance.status();
              workflowType = 'city-processor';
            } catch {
              // Not found in any workflow type
            }
          }
        }

        if (!status) {
          return new Response(
            JSON.stringify({ error: `Workflow not found: ${instanceId}` }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const response: WorkflowStatusResponse = {
          instanceId,
          workflowType,
          status: status.status,
          output: status.output,
          error: status.error ? {
            name: status.error.name || 'Error',
            message: status.error.message || 'Unknown error',
          } : undefined,
        };

        return new Response(JSON.stringify(response), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error(`[Worker] Failed to get workflow status:`, error);
        return new Response(
          JSON.stringify({
            error: 'Failed to get workflow status',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
          {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // POST /workflows/:id/pause - Pause workflow (not yet implemented)
    const workflowPauseMatch = url.pathname.match(/^\/workflows\/([a-f0-9-]+)\/pause$/i);
    if (workflowPauseMatch && request.method === 'POST') {
      return new Response(
        JSON.stringify({ error: 'Pause not yet implemented' }),
        { status: 501, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // POST /workflows/:id/resume - Resume workflow (not yet implemented)
    const workflowResumeMatch = url.pathname.match(/^\/workflows\/([a-f0-9-]+)\/resume$/i);
    if (workflowResumeMatch && request.method === 'POST') {
      return new Response(
        JSON.stringify({ error: 'Resume not yet implemented' }),
        { status: 501, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // POST /workflows/:id/cancel - Cancel workflow (not yet implemented)
    const workflowCancelMatch = url.pathname.match(/^\/workflows\/([a-f0-9-]+)\/cancel$/i);
    if (workflowCancelMatch && request.method === 'POST') {
      return new Response(
        JSON.stringify({ error: 'Cancel not yet implemented' }),
        { status: 501, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Default 404 response
    return new Response('Not found', { status: 404 });
  },

  /**
   * Scheduled handler for cron-triggered cache refresh
   * Runs weekly (Monday 2am UTC) to keep federal CFR cache fresh
   */
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    console.log('[Worker] Scheduled cache refresh triggered');

    try {
      const result = await refreshCFRCache(env.DOCUMENTS_BUCKET);

      if (result.success) {
        console.log(
          `[Worker] Scheduled refresh complete: ${result.titlesProcessed} titles, ` +
          `${result.partsProcessed} parts, ${result.sectionsProcessed} sections`
        );
      } else {
        console.error('[Worker] Scheduled refresh had errors:', result.errors);
      }
    } catch (error) {
      console.error('[Worker] Scheduled refresh failed:', error);
    }
  },
};
