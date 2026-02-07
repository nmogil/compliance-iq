/**
 * TexasBatchWorkflow
 *
 * Coordinator workflow that orchestrates processing of Texas statutes and TAC.
 * Spawns TexasCodeWorkflow and TexasTACWorkflow instances and aggregates results.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from '../../types';
import type {
  TexasBatchParams,
  TexasBatchResult,
  TexasCodeResult,
  TexasTACResult,
} from '../types';
import { TARGET_STATUTES, TARGET_TAC_TITLES } from '../../texas/types';
import { createStateManager } from '../utils/state-manager';

/**
 * TexasBatchWorkflow - Coordinate processing of all Texas sources
 *
 * @example
 * ```typescript
 * // Process all statutes and TAC
 * const instance = await env.TEXAS_BATCH_WORKFLOW.create({
 *   params: {}
 * });
 *
 * // Process only statutes
 * const instance = await env.TEXAS_BATCH_WORKFLOW.create({
 *   params: { statutesOnly: true }
 * });
 *
 * // Process specific codes
 * const instance = await env.TEXAS_BATCH_WORKFLOW.create({
 *   params: { statuteCodes: ['PE', 'HS'] }
 * });
 * ```
 */
export class TexasBatchWorkflow extends WorkflowEntrypoint<Env, TexasBatchParams> {
  override async run(
    event: WorkflowEvent<TexasBatchParams>,
    step: WorkflowStep
  ): Promise<TexasBatchResult> {
    const startTime = Date.now();
    const instanceId = event.instanceId;
    const {
      statutesOnly,
      tacOnly,
      statuteCodes: requestedCodes,
      tacTitles: requestedTitles,
    } = event.payload;

    console.log(
      `[TexasBatchWorkflow] Starting batch workflow (instance: ${instanceId})`
    );

    // Create state manager
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'texas-batch',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Determine what to process
      // ========================================================================
      const sourcesToProcess = await step.do('determine-sources', async () => {
        const codes: Array<{ abbreviation: string; name: string }> = [];
        const titles: Array<{ number: number; name: string }> = [];

        // Determine statute codes
        if (!tacOnly) {
          const enabledCodes = TARGET_STATUTES.filter((c) => c.enabled);
          let selectedCodes = enabledCodes;

          if (requestedCodes && requestedCodes.length > 0) {
            selectedCodes = enabledCodes.filter((c) =>
              requestedCodes.includes(c.abbreviation)
            );
          }

          for (const code of selectedCodes) {
            codes.push({ abbreviation: code.abbreviation, name: code.name });
          }
        }

        // Determine TAC titles
        if (!statutesOnly) {
          const enabledTitles = TARGET_TAC_TITLES.filter((t) => t.enabled);
          let selectedTitles = enabledTitles;

          if (requestedTitles && requestedTitles.length > 0) {
            selectedTitles = enabledTitles.filter((t) =>
              requestedTitles.includes(t.number)
            );
          }

          for (const title of selectedTitles) {
            titles.push({ number: title.number, name: title.name });
          }
        }

        console.log(
          `[TexasBatchWorkflow] Processing ${codes.length} statute codes and ${titles.length} TAC titles`
        );

        await state.put('sources', { codes, titles });

        return { codes, titles };
      });

      // ========================================================================
      // Step 2: Spawn statute code workflows
      // ========================================================================
      const codeWorkflows = await step.do('spawn-code-workflows', async () => {
        const children: Array<{
          codeAbbreviation: string;
          instanceId: string;
        }> = [];

        for (const code of sourcesToProcess.codes) {
          const childInstance = await this.env.TEXAS_CODE_WORKFLOW.create({
            params: {
              codeAbbreviation: code.abbreviation,
              parentInstanceId: instanceId,
            },
          });

          children.push({
            codeAbbreviation: code.abbreviation,
            instanceId: childInstance.id,
          });

          console.log(
            `[TexasBatchWorkflow] Spawned code workflow for ${code.abbreviation}: ${childInstance.id}`
          );
        }

        await state.put('codeWorkflows', children);

        return children;
      });

      // ========================================================================
      // Step 3: Spawn TAC workflows
      // ========================================================================
      const tacWorkflows = await step.do('spawn-tac-workflows', async () => {
        const children: Array<{
          tacTitleNumber: number;
          instanceId: string;
        }> = [];

        for (const title of sourcesToProcess.titles) {
          const childInstance = await this.env.TEXAS_TAC_WORKFLOW.create({
            params: {
              tacTitleNumber: title.number,
              parentInstanceId: instanceId,
            },
          });

          children.push({
            tacTitleNumber: title.number,
            instanceId: childInstance.id,
          });

          console.log(
            `[TexasBatchWorkflow] Spawned TAC workflow for title ${title.number}: ${childInstance.id}`
          );
        }

        await state.put('tacWorkflows', children);

        return children;
      });

      console.log(
        `[TexasBatchWorkflow] Spawned ${codeWorkflows.length} code workflows and ${tacWorkflows.length} TAC workflows`
      );

      // ========================================================================
      // Step 4: Wait for code workflows
      // ========================================================================
      const codeResults: TexasCodeResult[] = [];

      for (const child of codeWorkflows) {
        const result = await step.do(
          `wait-code-${child.codeAbbreviation}`,
          { retries: { limit: 1, delay: '1 second' } },
          async () => {
            console.log(
              `[TexasBatchWorkflow] Waiting for code ${child.codeAbbreviation}`
            );

            const instance = await this.env.TEXAS_CODE_WORKFLOW.get(
              child.instanceId
            );
            const status = await instance.status();

            if (status.status === 'complete') {
              return status.output as TexasCodeResult;
            } else if (status.status === 'errored') {
              return {
                success: false,
                durationMs: 0,
                error: status.error?.message || 'Workflow errored',
                data: {
                  codeAbbreviation: child.codeAbbreviation,
                  sectionsProcessed: 0,
                  chunksCreated: 0,
                  vectorsUpserted: 0,
                },
              } as TexasCodeResult;
            } else {
              throw new Error(`Unexpected status: ${status.status}`);
            }
          }
        );

        codeResults.push(result);
        console.log(
          `[TexasBatchWorkflow] Code ${child.codeAbbreviation}: ${result.success ? 'SUCCESS' : 'FAILED'}`
        );
      }

      // ========================================================================
      // Step 5: Wait for TAC workflows
      // ========================================================================
      const tacResults: TexasTACResult[] = [];

      for (const child of tacWorkflows) {
        const result = await step.do(
          `wait-tac-${child.tacTitleNumber}`,
          { retries: { limit: 1, delay: '1 second' } },
          async () => {
            console.log(
              `[TexasBatchWorkflow] Waiting for TAC title ${child.tacTitleNumber}`
            );

            const instance = await this.env.TEXAS_TAC_WORKFLOW.get(
              child.instanceId
            );
            const status = await instance.status();

            if (status.status === 'complete') {
              return status.output as TexasTACResult;
            } else if (status.status === 'errored') {
              return {
                success: false,
                durationMs: 0,
                error: status.error?.message || 'Workflow errored',
                data: {
                  tacTitleNumber: child.tacTitleNumber,
                  rulesProcessed: 0,
                  chunksCreated: 0,
                  vectorsUpserted: 0,
                },
              } as TexasTACResult;
            } else {
              throw new Error(`Unexpected status: ${status.status}`);
            }
          }
        );

        tacResults.push(result);
        console.log(
          `[TexasBatchWorkflow] TAC title ${child.tacTitleNumber}: ${result.success ? 'SUCCESS' : 'FAILED'}`
        );
      }

      // ========================================================================
      // Step 6: Aggregate results
      // ========================================================================
      const aggregated = await step.do('aggregate-results', async () => {
        const codeChunks = codeResults.reduce(
          (sum, r) => sum + (r.data?.chunksCreated ?? 0),
          0
        );
        const codeVectors = codeResults.reduce(
          (sum, r) => sum + (r.data?.vectorsUpserted ?? 0),
          0
        );
        const tacChunks = tacResults.reduce(
          (sum, r) => sum + (r.data?.chunksCreated ?? 0),
          0
        );
        const tacVectors = tacResults.reduce(
          (sum, r) => sum + (r.data?.vectorsUpserted ?? 0),
          0
        );

        return {
          statutesProcessed: codeResults.length,
          tacTitlesProcessed: tacResults.length,
          totalChunks: codeChunks + tacChunks,
          totalVectors: codeVectors + tacVectors,
          codeSuccessCount: codeResults.filter((r) => r.success).length,
          tacSuccessCount: tacResults.filter((r) => r.success).length,
        };
      });

      // ========================================================================
      // Step 7: Sync to Convex
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
              path: 'sources:updateTexasStatus',
              args: {
                status:
                  aggregated.codeSuccessCount === codeResults.length &&
                  aggregated.tacSuccessCount === tacResults.length
                    ? 'complete'
                    : 'partial',
                lastScrapedAt: Date.now(),
                statutesProcessed: aggregated.statutesProcessed,
                tacTitlesProcessed: aggregated.tacTitlesProcessed,
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
      // Step 8: Cleanup
      // ========================================================================
      await step.do('cleanup', async () => {
        return await state.cleanup();
      });

      const durationMs = Date.now() - startTime;
      const allSucceeded =
        codeResults.every((r) => r.success) &&
        tacResults.every((r) => r.success);

      console.log(
        `[TexasBatchWorkflow] Completed: ${aggregated.statutesProcessed} codes, ${aggregated.tacTitlesProcessed} TAC titles, ${aggregated.totalVectors} vectors in ${durationMs}ms`
      );

      return {
        success: allSucceeded,
        durationMs,
        data: {
          statutesProcessed: aggregated.statutesProcessed,
          tacTitlesProcessed: aggregated.tacTitlesProcessed,
          totalChunks: aggregated.totalChunks,
          totalVectors: aggregated.totalVectors,
          childWorkflowIds: [
            ...codeWorkflows.map((c) => c.instanceId),
            ...tacWorkflows.map((c) => c.instanceId),
          ],
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(`[TexasBatchWorkflow] Failed: ${errorMessage}`);

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
          statutesProcessed: 0,
          tacTitlesProcessed: 0,
          totalChunks: 0,
          totalVectors: 0,
          childWorkflowIds: [],
        },
      };
    }
  }
}
