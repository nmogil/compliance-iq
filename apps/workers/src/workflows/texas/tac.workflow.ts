/**
 * TexasTACWorkflow
 *
 * Worker workflow that processes a single Texas Administrative Code (TAC) title
 * through the full pipeline:
 * 1. Fetch TAC rules from Texas SOS
 * 2. Parse into rules
 * 3. Chunk rules for embedding
 * 4. Generate embeddings in batches
 * 5. Upsert vectors to Pinecone in batches
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from '../../types';
import type { TexasTACParams, TexasTACResult, StoredChunks } from '../types';
import {
  getEmbedBatchCount,
  getUpsertBatchCount,
  EMBED_BATCH_SIZE,
  UPSERT_BATCH_SIZE,
} from '../utils/step-helpers';
import { createStateManager } from '../utils/state-manager';
import { fetchTACTitle } from '../../texas/fetch-tac';
import { chunkTACRule, type TACChunkContext } from '../../texas/chunk';
import { TARGET_TAC_TITLES, type TACRule } from '../../texas/types';
import type { RecordMetadata } from '@pinecone-database/pinecone';

/**
 * TexasTACWorkflow - Process a single TAC title
 *
 * @example
 * ```typescript
 * const instance = await env.TEXAS_TAC_WORKFLOW.create({
 *   params: { tacTitleNumber: 16 }
 * });
 * ```
 */
export class TexasTACWorkflow extends WorkflowEntrypoint<Env, TexasTACParams> {
  override async run(
    event: WorkflowEvent<TexasTACParams>,
    step: WorkflowStep
  ): Promise<TexasTACResult> {
    const startTime = Date.now();
    const { tacTitleNumber, parentInstanceId: _parentInstanceId } = event.payload;
    const instanceId = event.instanceId;

    console.log(
      `[TexasTACWorkflow] Starting TAC title ${tacTitleNumber} (instance: ${instanceId})`
    );

    // Find title config
    const titleConfig = TARGET_TAC_TITLES.find(
      (t) => t.number === tacTitleNumber
    );
    if (!titleConfig) {
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: `Unknown TAC title: ${tacTitleNumber}`,
        data: {
          tacTitleNumber,
          rulesProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
        },
      };
    }

    // Create state manager
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'texas-tac',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Fetch TAC rules
      // ========================================================================
      const fetchResult = await step.do(
        'fetch-rules',
        { retries: { limit: 3, backoff: 'exponential', delay: 1000 } },
        async () => {
          console.log(`[TexasTACWorkflow] Fetching TAC title ${tacTitleNumber}`);

          const rules: TACRule[] = [];
          for await (const rule of fetchTACTitle(titleConfig)) {
            rules.push(rule);
          }

          // Store rules in R2
          await state.put('rules', rules);

          console.log(
            `[TexasTACWorkflow] Fetched ${rules.length} rules for TAC title ${tacTitleNumber}`
          );

          return {
            rulesCount: rules.length,
            fetchedAt: new Date().toISOString(),
          };
        }
      );

      if (fetchResult.rulesCount === 0) {
        console.log(
          `[TexasTACWorkflow] No rules found for TAC title ${tacTitleNumber}`
        );
        await state.cleanup();
        return {
          success: true,
          durationMs: Date.now() - startTime,
          data: {
            tacTitleNumber,
            rulesProcessed: 0,
            chunksCreated: 0,
            vectorsUpserted: 0,
          },
        };
      }

      // ========================================================================
      // Step 2: Chunk rules
      // ========================================================================
      const chunkResult = await step.do('chunk-rules', async () => {
        console.log(`[TexasTACWorkflow] Chunking TAC title ${tacTitleNumber}`);

        const rules = await state.getRequired<TACRule[]>('rules');
        const category = titleConfig.categories[0];

        const allChunks: StoredChunks['chunks'] = [];

        for (const rule of rules) {
          const context: TACChunkContext = {
            title: tacTitleNumber,
            titleName: titleConfig.name,
            chapter: rule.chapter,
            category,
          };

          const chunks = chunkTACRule(rule, context);

          for (const chunk of chunks) {
            allChunks.push({
              chunkId: chunk.chunkId,
              text: chunk.text,
              metadata: {
                chunkId: chunk.chunkId,
                sourceId: chunk.sourceId,
                sourceType: 'state',
                jurisdiction: 'TX',
                text: chunk.text,
                citation: chunk.citation,
                chunkIndex: chunk.chunkIndex,
                totalChunks: chunk.totalChunks,
                ...(chunk.category ? { category: chunk.category } : {}),
                indexedAt: new Date().toISOString(),
              },
            });
          }
        }

        await state.put('chunks', { chunks: allChunks, count: allChunks.length });

        return {
          chunksCreated: allChunks.length,
          embedBatchCount: getEmbedBatchCount(allChunks.length),
          upsertBatchCount: getUpsertBatchCount(allChunks.length),
        };
      });

      if (chunkResult.chunksCreated === 0) {
        console.log(
          `[TexasTACWorkflow] No chunks created for TAC title ${tacTitleNumber}`
        );
        await state.cleanup();
        return {
          success: true,
          durationMs: Date.now() - startTime,
          data: {
            tacTitleNumber,
            rulesProcessed: fetchResult.rulesCount,
            chunksCreated: 0,
            vectorsUpserted: 0,
          },
        };
      }

      // ========================================================================
      // Step 3: Embed chunks in batches
      // ========================================================================
      let totalEmbedded = 0;

      for (let i = 0; i < chunkResult.embedBatchCount; i++) {
        const embeddedCount = await step.do(
          `embed-batch-${i}`,
          { retries: { limit: 4, backoff: 'exponential', delay: 1000 } },
          async () => {
            const { chunks } = await state.getRequired<StoredChunks>('chunks');

            const startIdx = i * EMBED_BATCH_SIZE;
            const endIdx = Math.min(startIdx + EMBED_BATCH_SIZE, chunks.length);
            const batchChunks = chunks.slice(startIdx, endIdx);

            if (batchChunks.length === 0) return 0;

            const { default: OpenAI } = await import('openai');
            const openai = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });

            const texts = batchChunks.map((c) => c.text);
            const response = await openai.embeddings.create({
              model: 'text-embedding-3-large',
              input: texts,
              encoding_format: 'float',
            });

            const embeddings = response.data.map((d, idx) => ({
              chunkId: batchChunks[idx]!.chunkId,
              values: d.embedding,
            }));

            await state.put(`embeddings-${i}`, {
              embeddings,
              count: embeddings.length,
            });

            return embeddings.length;
          }
        );

        totalEmbedded += embeddedCount;
      }

      // ========================================================================
      // Step 4: Upsert vectors to Pinecone
      // ========================================================================
      let totalUpserted = 0;

      for (let i = 0; i < chunkResult.upsertBatchCount; i++) {
        const upsertedCount = await step.do(
          `upsert-batch-${i}`,
          { retries: { limit: 3, backoff: 'exponential', delay: 500 } },
          async () => {
            const { chunks } = await state.getRequired<StoredChunks>('chunks');

            const startIdx = i * UPSERT_BATCH_SIZE;
            const endIdx = Math.min(startIdx + UPSERT_BATCH_SIZE, chunks.length);
            const batchChunks = chunks.slice(startIdx, endIdx);

            if (batchChunks.length === 0) return 0;

            const firstEmbedBatch = Math.floor(startIdx / EMBED_BATCH_SIZE);
            const lastEmbedBatch = Math.floor((endIdx - 1) / EMBED_BATCH_SIZE);

            const allEmbeddings: Array<{ chunkId: string; values: number[] }> =
              [];
            for (let eb = firstEmbedBatch; eb <= lastEmbedBatch; eb++) {
              const embedData = await state.getRequired<{
                embeddings: Array<{ chunkId: string; values: number[] }>;
              }>(`embeddings-${eb}`);
              allEmbeddings.push(...embedData.embeddings);
            }

            const embeddingMap = new Map(
              allEmbeddings.map((e) => [e.chunkId, e.values])
            );

            const vectors = batchChunks.map((chunk) => {
              const values = embeddingMap.get(chunk.chunkId);
              if (!values) {
                throw new Error(`Missing embedding: ${chunk.chunkId}`);
              }
              return {
                id: chunk.chunkId,
                values,
                metadata: chunk.metadata as RecordMetadata,
              };
            });

            const { Pinecone } = await import('@pinecone-database/pinecone');
            const pinecone = new Pinecone({ apiKey: this.env.PINECONE_API_KEY });
            const index = pinecone.index('compliance-embeddings');

            await index.upsert(vectors);

            return vectors.length;
          }
        );

        totalUpserted += upsertedCount;
      }

      // ========================================================================
      // Step 5: Cleanup
      // ========================================================================
      await step.do('cleanup', async () => {
        const cleaned = await state.cleanup();
        return cleaned;
      });

      const durationMs = Date.now() - startTime;

      console.log(
        `[TexasTACWorkflow] Completed TAC title ${tacTitleNumber}: ${totalUpserted} vectors in ${durationMs}ms`
      );

      return {
        success: true,
        durationMs,
        data: {
          tacTitleNumber,
          rulesProcessed: fetchResult.rulesCount,
          chunksCreated: chunkResult.chunksCreated,
          vectorsUpserted: totalUpserted,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(
        `[TexasTACWorkflow] Failed TAC title ${tacTitleNumber}: ${errorMessage}`
      );

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
          tacTitleNumber,
          rulesProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
        },
      };
    }
  }
}
