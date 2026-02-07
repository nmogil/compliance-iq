/**
 * FederalBatchWorkflow
 *
 * Coordinator workflow that orchestrates processing of multiple CFR titles.
 * Spawns FederalTitleWorkflow instances for each title and aggregates results.
 *
 * Pattern: Coordinator spawns workers, waits for completion, aggregates results.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from '../../types';
import type {
  FederalBatchParams,
  FederalBatchResult,
  FederalTitleResult,
} from '../types';
import { TARGET_TITLES } from '../../federal/types';
import { createStateManager } from '../utils/state-manager';

/**
 * FederalBatchWorkflow - Coordinate processing of all federal CFR titles
 *
 * @example
 * ```typescript
 * // Process all enabled titles
 * const instance = await env.FEDERAL_BATCH_WORKFLOW.create({
 *   params: {}
 * });
 *
 * // Process specific titles
 * const instance = await env.FEDERAL_BATCH_WORKFLOW.create({
 *   params: { titles: [21, 27] }
 * });
 * ```
 */
export class FederalBatchWorkflow extends WorkflowEntrypoint<
  Env,
  FederalBatchParams
> {
  override async run(
    event: WorkflowEvent<FederalBatchParams>,
    step: WorkflowStep
  ): Promise<FederalBatchResult> {
    const startTime = Date.now();
    const instanceId = event.instanceId;
    const { titles: requestedTitles } = event.payload;

    console.log(
      `[FederalBatchWorkflow] Starting batch workflow (instance: ${instanceId})`
    );

    // Create state manager for this instance
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'federal-batch',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Determine which titles to process
      // ========================================================================
      const titlesToProcess = await step.do('determine-titles', async () => {
        const enabledTitles = TARGET_TITLES.filter((t) => t.enabled);

        let selectedTitles = enabledTitles;
        if (requestedTitles && requestedTitles.length > 0) {
          selectedTitles = enabledTitles.filter((t) =>
            requestedTitles.includes(t.number)
          );
        }

        console.log(
          `[FederalBatchWorkflow] Processing ${selectedTitles.length} titles: ${selectedTitles.map((t) => t.number).join(', ')}`
        );

        // Store the titles to process
        await state.put('titles', selectedTitles);

        return selectedTitles.map((t) => ({
          number: t.number,
          name: t.name,
        }));
      });

      // ========================================================================
      // Step 2: Spawn child workflows for each title
      // ========================================================================
      const childWorkflows = await step.do('spawn-children', async () => {
        const children: Array<{
          titleNumber: number;
          instanceId: string;
        }> = [];

        for (const title of titlesToProcess) {
          // Create a child workflow for this title
          const childInstance = await this.env.FEDERAL_TITLE_WORKFLOW.create({
            params: {
              titleNumber: title.number,
              parentInstanceId: instanceId,
            },
          });

          children.push({
            titleNumber: title.number,
            instanceId: childInstance.id,
          });

          console.log(
            `[FederalBatchWorkflow] Spawned child for title ${title.number}: ${childInstance.id}`
          );
        }

        // Store child workflow IDs
        await state.put('children', children);

        return children;
      });

      console.log(
        `[FederalBatchWorkflow] Spawned ${childWorkflows.length} child workflows`
      );

      // ========================================================================
      // Step 3: Wait for each child workflow to complete
      // ========================================================================
      const results: FederalTitleResult[] = [];

      for (const child of childWorkflows) {
        const result = await step.do(
          `wait-title-${child.titleNumber}`,
          { retries: { limit: 1, delay: '1 second' } }, // Child handles its own retries
          async () => {
            console.log(
              `[FederalBatchWorkflow] Waiting for title ${child.titleNumber} (${child.instanceId})`
            );

            // Get the workflow instance
            const instance = await this.env.FEDERAL_TITLE_WORKFLOW.get(
              child.instanceId
            );

            // Wait for completion (this blocks until the child finishes)
            const status = await instance.status();

            if (status.status === 'complete') {
              return status.output as FederalTitleResult;
            } else if (status.status === 'errored') {
              return {
                success: false,
                durationMs: 0,
                error: status.error?.message || 'Workflow errored',
                data: {
                  titleNumber: child.titleNumber,
                  partsProcessed: 0,
                  chunksCreated: 0,
                  vectorsUpserted: 0,
                },
              } as FederalTitleResult;
            } else {
              // Still running - this shouldn't happen with await
              throw new Error(
                `Unexpected status: ${status.status} for title ${child.titleNumber}`
              );
            }
          }
        );

        results.push(result);

        // Log progress
        console.log(
          `[FederalBatchWorkflow] Title ${child.titleNumber}: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.data?.vectorsUpserted ?? 0} vectors`
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
          `[FederalBatchWorkflow] Aggregated: ${successCount}/${results.length} succeeded, ${totalVectors} vectors`
        );

        return {
          titlesProcessed: results.length,
          totalChunks,
          totalVectors,
          successCount,
        };
      });

      // ========================================================================
      // Step 5: Sync to Convex (best-effort)
      // ========================================================================
      await step.do('sync-convex', async () => {
        if (!this.env.CONVEX_URL) {
          console.log('[FederalBatchWorkflow] No CONVEX_URL, skipping sync');
          return { synced: false };
        }

        try {
          const response = await fetch(`${this.env.CONVEX_URL}/api/mutation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              path: 'sources:updateFederalStatus',
              args: {
                status:
                  aggregated.successCount === results.length
                    ? 'complete'
                    : 'partial',
                lastScrapedAt: Date.now(),
                titlesProcessed: aggregated.titlesProcessed,
                totalVectors: aggregated.totalVectors,
                durationMs: Date.now() - startTime,
              },
            }),
          });

          if (!response.ok) {
            console.warn(
              `[FederalBatchWorkflow] Convex sync failed: ${response.status}`
            );
          }

          return { synced: response.ok };
        } catch (error) {
          console.warn(
            `[FederalBatchWorkflow] Convex sync error: ${error instanceof Error ? error.message : 'Unknown'}`
          );
          return { synced: false };
        }
      });

      // ========================================================================
      // Step 6: Cleanup
      // ========================================================================
      await step.do('cleanup', async () => {
        const cleaned = await state.cleanup();
        console.log(`[FederalBatchWorkflow] Cleaned up ${cleaned} state files`);
        return cleaned;
      });

      const durationMs = Date.now() - startTime;
      const allSucceeded = results.every((r) => r.success);

      console.log(
        `[FederalBatchWorkflow] Completed: ${aggregated.titlesProcessed} titles, ${aggregated.totalVectors} vectors in ${durationMs}ms`
      );

      return {
        success: allSucceeded,
        durationMs,
        data: {
          titlesProcessed: aggregated.titlesProcessed,
          totalChunks: aggregated.totalChunks,
          totalVectors: aggregated.totalVectors,
          childWorkflowIds: childWorkflows.map((c) => c.instanceId),
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(`[FederalBatchWorkflow] Failed: ${errorMessage}`);

      // Try to clean up on failure
      try {
        await state.cleanup();
      } catch {
        // Ignore cleanup errors
      }

      return {
        success: false,
        durationMs,
        error: errorMessage,
        data: {
          titlesProcessed: 0,
          totalChunks: 0,
          totalVectors: 0,
          childWorkflowIds: [],
        },
      };
    }
  }
}
