/**
 * CountyBatchWorkflow
 *
 * Coordinator workflow that orchestrates processing of multiple Texas counties.
 * Spawns CountyProcessorWorkflow instances for each county and aggregates results.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from '../../types';
import type {
  CountyBatchParams,
  CountyBatchResult,
  CountyProcessorResult,
} from '../types';
import { getEnabledCounties, getCountyByName } from '../../counties/sources';
import { createStateManager } from '../utils/state-manager';

/**
 * CountyBatchWorkflow - Coordinate processing of all Texas counties
 *
 * @example
 * ```typescript
 * // Process all enabled counties
 * const instance = await env.COUNTY_BATCH_WORKFLOW.create({
 *   params: {}
 * });
 *
 * // Process specific counties
 * const instance = await env.COUNTY_BATCH_WORKFLOW.create({
 *   params: { countyNames: ['Harris', 'Dallas'] }
 * });
 * ```
 */
export class CountyBatchWorkflow extends WorkflowEntrypoint<
  Env,
  CountyBatchParams
> {
  override async run(
    event: WorkflowEvent<CountyBatchParams>,
    step: WorkflowStep
  ): Promise<CountyBatchResult> {
    const startTime = Date.now();
    const instanceId = event.instanceId;
    const { countyNames: requestedCounties } = event.payload;

    console.log(
      `[CountyBatchWorkflow] Starting batch workflow (instance: ${instanceId})`
    );

    // Create state manager
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'county-batch',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Determine which counties to process
      // ========================================================================
      const countiesToProcess = await step.do('determine-counties', async () => {
        const enabledCounties = getEnabledCounties();

        let selectedCounties = enabledCounties;
        if (requestedCounties && requestedCounties.length > 0) {
          selectedCounties = requestedCounties
            .map((name) => getCountyByName(name))
            .filter((c): c is NonNullable<typeof c> => c !== undefined && c.enabled);
        }

        console.log(
          `[CountyBatchWorkflow] Processing ${selectedCounties.length} counties: ${selectedCounties.map((c) => c.name).join(', ')}`
        );

        await state.put('counties', selectedCounties);

        return selectedCounties.map((c) => ({
          name: c.name,
          fipsCode: c.fipsCode,
        }));
      });

      // ========================================================================
      // Step 2: Spawn child workflows for each county
      // ========================================================================
      const childWorkflows = await step.do('spawn-children', async () => {
        const children: Array<{
          countyName: string;
          fipsCode: string;
          instanceId: string;
        }> = [];

        for (const county of countiesToProcess) {
          const childInstance = await this.env.COUNTY_PROCESSOR_WORKFLOW.create({
            params: {
              countyName: county.name,
              fipsCode: county.fipsCode,
              parentInstanceId: instanceId,
            },
          });

          children.push({
            countyName: county.name,
            fipsCode: county.fipsCode,
            instanceId: childInstance.id,
          });

          console.log(
            `[CountyBatchWorkflow] Spawned child for ${county.name} County: ${childInstance.id}`
          );
        }

        await state.put('children', children);

        return children;
      });

      console.log(
        `[CountyBatchWorkflow] Spawned ${childWorkflows.length} child workflows`
      );

      // ========================================================================
      // Step 3: Wait for each child workflow to complete
      // ========================================================================
      const results: CountyProcessorResult[] = [];

      for (const child of childWorkflows) {
        const result = await step.do(
          `wait-county-${child.countyName.toLowerCase().replace(/\s+/g, '-')}`,
          { retries: { limit: 1, delay: '1 second' } },
          async () => {
            console.log(
              `[CountyBatchWorkflow] Waiting for ${child.countyName} County (${child.instanceId})`
            );

            const instance = await this.env.COUNTY_PROCESSOR_WORKFLOW.get(
              child.instanceId
            );
            const status = await instance.status();

            if (status.status === 'complete') {
              return status.output as CountyProcessorResult;
            } else if (status.status === 'errored') {
              return {
                success: false,
                durationMs: 0,
                error: status.error?.message || 'Workflow errored',
                data: {
                  countyName: child.countyName,
                  ordinancesProcessed: 0,
                  chunksCreated: 0,
                  vectorsUpserted: 0,
                },
              } as CountyProcessorResult;
            } else {
              throw new Error(
                `Unexpected status: ${status.status} for ${child.countyName} County`
              );
            }
          }
        );

        results.push(result);

        console.log(
          `[CountyBatchWorkflow] ${child.countyName} County: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.data?.vectorsUpserted ?? 0} vectors`
        );
      }

      // ========================================================================
      // Step 4: Aggregate results
      // ========================================================================
      const aggregated = await step.do('aggregate-results', async () => {
        const totalChunks = results.reduce(
          (sum, r) => sum + (r.data?.chunksCreated ?? 0),
          0
        );
        const totalVectors = results.reduce(
          (sum, r) => sum + (r.data?.vectorsUpserted ?? 0),
          0
        );
        const successCount = results.filter((r) => r.success).length;

        console.log(
          `[CountyBatchWorkflow] Aggregated: ${successCount}/${results.length} succeeded, ${totalVectors} vectors`
        );

        return {
          countiesProcessed: results.length,
          totalChunks,
          totalVectors,
          successCount,
        };
      });

      // ========================================================================
      // Step 5: Sync to Convex
      // ========================================================================
      await step.do('sync-convex', async () => {
        if (!this.env.CONVEX_URL) {
          return { synced: false };
        }

        try {
          const response = await fetch(`${this.env.CONVEX_URL}/api/mutation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: 'sources:updateCountyStatus',
              args: {
                status:
                  aggregated.successCount === results.length
                    ? 'complete'
                    : 'partial',
                lastScrapedAt: Date.now(),
                countiesProcessed: aggregated.countiesProcessed,
                totalVectors: aggregated.totalVectors,
                durationMs: Date.now() - startTime,
              },
            }),
          });

          return { synced: response.ok };
        } catch {
          return { synced: false };
        }
      });

      // ========================================================================
      // Step 6: Cleanup
      // ========================================================================
      await step.do('cleanup', async () => {
        return await state.cleanup();
      });

      const durationMs = Date.now() - startTime;
      const allSucceeded = results.every((r) => r.success);

      console.log(
        `[CountyBatchWorkflow] Completed: ${aggregated.countiesProcessed} counties, ${aggregated.totalVectors} vectors in ${durationMs}ms`
      );

      return {
        success: allSucceeded,
        durationMs,
        data: {
          countiesProcessed: aggregated.countiesProcessed,
          totalChunks: aggregated.totalChunks,
          totalVectors: aggregated.totalVectors,
          childWorkflowIds: childWorkflows.map((c) => c.instanceId),
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(`[CountyBatchWorkflow] Failed: ${errorMessage}`);

      try {
        await state.cleanup();
      } catch {
        // Ignore
      }

      return {
        success: false,
        durationMs,
        error: errorMessage,
        data: {
          countiesProcessed: 0,
          totalChunks: 0,
          totalVectors: 0,
          childWorkflowIds: [],
        },
      };
    }
  }
}
