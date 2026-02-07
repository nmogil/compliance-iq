/**
 * CountyProcessorWorkflow
 *
 * Worker workflow that processes a single Texas county through the full pipeline:
 * 1. Fetch ordinances via platform adapter
 * 2. Parse into ordinance sections
 * 3. Chunk ordinances for embedding
 * 4. Generate embeddings in batches
 * 5. Upsert vectors to Pinecone in batches
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from '../../types';
import type {
  CountyProcessorParams,
  CountyProcessorResult,
  StoredChunks,
} from '../types';
import {
  getEmbedBatchCount,
  getUpsertBatchCount,
  EMBED_BATCH_SIZE,
  UPSERT_BATCH_SIZE,
} from '../utils/step-helpers';
import { createStateManager } from '../utils/state-manager';
import { getAdapterForCounty } from '../../counties/adapters';
import { chunkCountyOrdinance, type CountyChunkContext } from '../../counties/chunk';
import { getCountyByName } from '../../counties/sources';
import type { CountyOrdinance } from '../../counties/types';
import type { RecordMetadata } from '@pinecone-database/pinecone';

/**
 * CountyProcessorWorkflow - Process a single county
 *
 * @example
 * ```typescript
 * const instance = await env.COUNTY_PROCESSOR_WORKFLOW.create({
 *   params: { countyName: 'Harris', fipsCode: '48201' }
 * });
 * ```
 */
export class CountyProcessorWorkflow extends WorkflowEntrypoint<
  Env,
  CountyProcessorParams
> {
  override async run(
    event: WorkflowEvent<CountyProcessorParams>,
    step: WorkflowStep
  ): Promise<CountyProcessorResult> {
    const startTime = Date.now();
    const { countyName, fipsCode, parentInstanceId: _parentInstanceId } = event.payload;
    const instanceId = event.instanceId;

    console.log(
      `[CountyProcessorWorkflow] Starting ${countyName} County (instance: ${instanceId})`
    );

    // Find county config
    const countyConfig = getCountyByName(countyName);
    if (!countyConfig) {
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: `Unknown county: ${countyName}`,
        data: {
          countyName,
          ordinancesProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
        },
      };
    }

    // Create state manager
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'county-processor',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Fetch ordinances via adapter
      // ========================================================================
      const fetchResult = await step.do(
        'fetch-ordinances',
        { retries: { limit: 3, backoff: 'exponential', delay: 2000 } },
        async () => {
          console.log(
            `[CountyProcessorWorkflow] Fetching ordinances for ${countyName} County`
          );

          // Get adapter for this county's platform
          const adapter = getAdapterForCounty(countyName);
          if (!adapter) {
            throw new Error(`No adapter available for county: ${countyName}`);
          }

          // Validate source is accessible
          const validation = await adapter.validateSource();
          if (!validation.accessible) {
            throw new Error(`Source validation failed: ${validation.error}`);
          }

          // Fetch all ordinances
          const ordinances: CountyOrdinance[] = [];
          for await (const ordinance of adapter.fetchOrdinances()) {
            ordinances.push(ordinance);
          }

          // Store ordinances in R2
          await state.put('ordinances', ordinances);

          console.log(
            `[CountyProcessorWorkflow] Fetched ${ordinances.length} ordinances for ${countyName} County`
          );

          return {
            ordinancesCount: ordinances.length,
            fetchedAt: new Date().toISOString(),
          };
        }
      );

      if (fetchResult.ordinancesCount === 0) {
        console.log(
          `[CountyProcessorWorkflow] No ordinances found for ${countyName} County`
        );
        await state.cleanup();
        return {
          success: true,
          durationMs: Date.now() - startTime,
          data: {
            countyName,
            ordinancesProcessed: 0,
            chunksCreated: 0,
            vectorsUpserted: 0,
          },
        };
      }

      // ========================================================================
      // Step 2: Chunk ordinances
      // ========================================================================
      const chunkResult = await step.do('chunk-ordinances', async () => {
        console.log(
          `[CountyProcessorWorkflow] Chunking ordinances for ${countyName} County`
        );

        const ordinances =
          await state.getRequired<CountyOrdinance[]>('ordinances');
        const category = countyConfig.categories[0];

        const allChunks: StoredChunks['chunks'] = [];

        for (const ordinance of ordinances) {
          const context: CountyChunkContext = {
            county: countyName,
            fipsCode,
            codeName: 'Code of Ordinances',
            category,
          };

          const chunks = chunkCountyOrdinance(ordinance, context);

          for (const chunk of chunks) {
            allChunks.push({
              chunkId: chunk.chunkId,
              text: chunk.text,
              metadata: {
                chunkId: chunk.chunkId,
                sourceId: chunk.sourceId,
                sourceType: 'county',
                jurisdiction: `TX-${fipsCode}`,
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
          `[CountyProcessorWorkflow] No chunks created for ${countyName} County`
        );
        await state.cleanup();
        return {
          success: true,
          durationMs: Date.now() - startTime,
          data: {
            countyName,
            ordinancesProcessed: fetchResult.ordinancesCount,
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
        return await state.cleanup();
      });

      const durationMs = Date.now() - startTime;

      console.log(
        `[CountyProcessorWorkflow] Completed ${countyName} County: ${totalUpserted} vectors in ${durationMs}ms`
      );

      return {
        success: true,
        durationMs,
        data: {
          countyName,
          ordinancesProcessed: fetchResult.ordinancesCount,
          chunksCreated: chunkResult.chunksCreated,
          vectorsUpserted: totalUpserted,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(
        `[CountyProcessorWorkflow] Failed ${countyName} County: ${errorMessage}`
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
          countyName,
          ordinancesProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
        },
      };
    }
  }
}
