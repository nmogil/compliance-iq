/**
 * MunicipalBatchWorkflow
 *
 * Coordinator workflow that orchestrates processing of multiple Texas cities.
 * Spawns CityProcessorWorkflow instances for each city and aggregates results.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from '../../types';
import type {
  MunicipalBatchParams,
  MunicipalBatchResult,
  CityProcessorResult,
} from '../types';
import { getEnabledCities, getCityById } from '../../municipal/cities';
import { createStateManager } from '../utils/state-manager';

/**
 * MunicipalBatchWorkflow - Coordinate processing of all Texas cities
 *
 * @example
 * ```typescript
 * // Process all enabled cities
 * const instance = await env.MUNICIPAL_BATCH_WORKFLOW.create({
 *   params: {}
 * });
 *
 * // Process specific cities
 * const instance = await env.MUNICIPAL_BATCH_WORKFLOW.create({
 *   params: { cityIds: ['houston', 'dallas'] }
 * });
 * ```
 */
export class MunicipalBatchWorkflow extends WorkflowEntrypoint<
  Env,
  MunicipalBatchParams
> {
  override async run(
    event: WorkflowEvent<MunicipalBatchParams>,
    step: WorkflowStep
  ): Promise<MunicipalBatchResult> {
    const startTime = Date.now();
    const instanceId = event.instanceId;
    const { cityIds: requestedCities, skipCache } = event.payload;

    console.log(
      `[MunicipalBatchWorkflow] Starting batch workflow (instance: ${instanceId})`
    );

    // Create state manager
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'municipal-batch',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Determine which cities to process
      // ========================================================================
      const citiesToProcess = await step.do('determine-cities', async () => {
        const enabledCities = getEnabledCities();

        let selectedCities = enabledCities;
        if (requestedCities && requestedCities.length > 0) {
          selectedCities = requestedCities
            .map((id) => getCityById(id))
            .filter(
              (c): c is NonNullable<typeof c> => c !== undefined && c.enabled
            );
        }

        console.log(
          `[MunicipalBatchWorkflow] Processing ${selectedCities.length} cities: ${selectedCities.map((c) => c.name).join(', ')}`
        );

        await state.put('cities', selectedCities);

        return selectedCities.map((c) => ({
          cityId: c.cityId,
          name: c.name,
        }));
      });

      // ========================================================================
      // Step 2: Spawn child workflows for each city
      // ========================================================================
      const childWorkflows = await step.do('spawn-children', async () => {
        const children: Array<{
          cityId: string;
          cityName: string;
          instanceId: string;
        }> = [];

        for (const city of citiesToProcess) {
          const childInstance = await this.env.CITY_PROCESSOR_WORKFLOW.create({
            params: {
              cityId: city.cityId,
              skipCache,
              parentInstanceId: instanceId,
            },
          });

          children.push({
            cityId: city.cityId,
            cityName: city.name,
            instanceId: childInstance.id,
          });

          console.log(
            `[MunicipalBatchWorkflow] Spawned child for ${city.name}: ${childInstance.id}`
          );
        }

        await state.put('children', children);

        return children;
      });

      console.log(
        `[MunicipalBatchWorkflow] Spawned ${childWorkflows.length} child workflows`
      );

      // ========================================================================
      // Step 3: Wait for each child workflow to complete
      // ========================================================================
      const results: CityProcessorResult[] = [];

      for (const child of childWorkflows) {
        const result = await step.do(
          `wait-city-${child.cityId}`,
          { retries: { limit: 1, delay: '1 second' } },
          async () => {
            console.log(
              `[MunicipalBatchWorkflow] Waiting for ${child.cityName} (${child.instanceId})`
            );

            const instance = await this.env.CITY_PROCESSOR_WORKFLOW.get(
              child.instanceId
            );
            const status = await instance.status();

            if (status.status === 'complete') {
              return status.output as CityProcessorResult;
            } else if (status.status === 'errored') {
              return {
                success: false,
                durationMs: 0,
                error: status.error?.message || 'Workflow errored',
                data: {
                  cityId: child.cityId,
                  cityName: child.cityName,
                  ordinancesProcessed: 0,
                  chunksCreated: 0,
                  vectorsUpserted: 0,
                  creditsUsed: 0,
                  fromCache: false,
                },
              } as CityProcessorResult;
            } else {
              throw new Error(
                `Unexpected status: ${status.status} for ${child.cityName}`
              );
            }
          }
        );

        results.push(result);

        console.log(
          `[MunicipalBatchWorkflow] ${child.cityName}: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.data?.vectorsUpserted ?? 0} vectors`
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
        const totalCreditsUsed = results.reduce(
          (sum, r) => sum + (r.data?.creditsUsed ?? 0),
          0
        );
        const successCount = results.filter((r) => r.success).length;

        console.log(
          `[MunicipalBatchWorkflow] Aggregated: ${successCount}/${results.length} succeeded, ${totalVectors} vectors, ${totalCreditsUsed} credits`
        );

        return {
          citiesProcessed: results.length,
          totalChunks,
          totalVectors,
          totalCreditsUsed,
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
              path: 'sources:updateMunicipalStatus',
              args: {
                status:
                  aggregated.successCount === results.length
                    ? 'complete'
                    : 'partial',
                lastScrapedAt: Date.now(),
                citiesProcessed: aggregated.citiesProcessed,
                totalVectors: aggregated.totalVectors,
                totalCreditsUsed: aggregated.totalCreditsUsed,
                durationMs: Date.now() - startTime,
                failedCities: results
                  .filter((r) => !r.success)
                  .map((r) => r.data?.cityName ?? 'unknown'),
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
        `[MunicipalBatchWorkflow] Completed: ${aggregated.citiesProcessed} cities, ${aggregated.totalVectors} vectors, ${aggregated.totalCreditsUsed} credits in ${durationMs}ms`
      );

      return {
        success: allSucceeded,
        durationMs,
        data: {
          citiesProcessed: aggregated.citiesProcessed,
          totalChunks: aggregated.totalChunks,
          totalVectors: aggregated.totalVectors,
          totalCreditsUsed: aggregated.totalCreditsUsed,
          childWorkflowIds: childWorkflows.map((c) => c.instanceId),
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(`[MunicipalBatchWorkflow] Failed: ${errorMessage}`);

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
          citiesProcessed: 0,
          totalChunks: 0,
          totalVectors: 0,
          totalCreditsUsed: 0,
          childWorkflowIds: [],
        },
      };
    }
  }
}
