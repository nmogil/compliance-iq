/**
 * CityProcessorWorkflow
 *
 * Worker workflow that processes a single Texas city through the full pipeline:
 * 1. Fetch ordinances via Firecrawl
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
  CityProcessorParams,
  CityProcessorResult,
  StoredChunks,
} from '../types';
import {
  getEmbedBatchCount,
  getUpsertBatchCount,
  EMBED_BATCH_SIZE,
  UPSERT_BATCH_SIZE,
} from '../utils/step-helpers';
import { createStateManager } from '../utils/state-manager';
import { getCityById } from '../../municipal/cities';
import { fetchCity, type Env as FetchEnv } from '../../municipal/fetch';
import { chunkCity } from '../../municipal/chunk';
import type { MunicipalOrdinance } from '../../municipal/types';
import type { RecordMetadata } from '@pinecone-database/pinecone';

/**
 * CityProcessorWorkflow - Process a single city
 *
 * @example
 * ```typescript
 * const instance = await env.CITY_PROCESSOR_WORKFLOW.create({
 *   params: { cityId: 'houston' }
 * });
 * ```
 */
export class CityProcessorWorkflow extends WorkflowEntrypoint<
  Env,
  CityProcessorParams
> {
  override async run(
    event: WorkflowEvent<CityProcessorParams>,
    step: WorkflowStep
  ): Promise<CityProcessorResult> {
    const startTime = Date.now();
    const { cityId, skipCache, parentInstanceId: _parentInstanceId } = event.payload;
    const instanceId = event.instanceId;

    console.log(
      `[CityProcessorWorkflow] Starting city ${cityId} (instance: ${instanceId})`
    );

    // Find city config
    const cityConfig = getCityById(cityId);
    if (!cityConfig) {
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: `Unknown city: ${cityId}`,
        data: {
          cityId,
          cityName: cityId,
          ordinancesProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
          creditsUsed: 0,
          fromCache: false,
        },
      };
    }

    if (!cityConfig.enabled) {
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: `City is disabled: ${cityConfig.skipReason ?? 'no reason given'}`,
        data: {
          cityId,
          cityName: cityConfig.name,
          ordinancesProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
          creditsUsed: 0,
          fromCache: false,
        },
      };
    }

    // Create state manager
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'city-processor',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Fetch ordinances via Firecrawl
      // ========================================================================
      const fetchResult = await step.do(
        'fetch-ordinances',
        { retries: { limit: 3, backoff: 'exponential', delay: 2000 } },
        async () => {
          console.log(
            `[CityProcessorWorkflow] Fetching ordinances for ${cityConfig.name}`
          );

          // Use municipal fetch module (handles Firecrawl + caching)
          const result = await fetchCity(
            {
              DOCUMENTS_BUCKET: this.env.DOCUMENTS_BUCKET,
              R2_BUCKET: this.env.DOCUMENTS_BUCKET,
              FIRECRAWL_API_KEY: this.env.FIRECRAWL_API_KEY,
            } as FetchEnv,
            cityConfig,
            { skipCache }
          );

          // Store ordinances in R2
          await state.put('ordinances', result.ordinances);

          console.log(
            `[CityProcessorWorkflow] Fetched ${result.ordinances.length} ordinances for ${cityConfig.name} (${result.fromCache ? 'cached' : 'fresh'})`
          );

          return {
            ordinancesCount: result.ordinances.length,
            creditsUsed: result.creditsUsed,
            fromCache: result.fromCache,
            fetchedAt: new Date().toISOString(),
          };
        }
      );

      if (fetchResult.ordinancesCount === 0) {
        console.log(
          `[CityProcessorWorkflow] No ordinances found for ${cityConfig.name}`
        );
        await state.cleanup();
        return {
          success: true,
          durationMs: Date.now() - startTime,
          data: {
            cityId,
            cityName: cityConfig.name,
            ordinancesProcessed: 0,
            chunksCreated: 0,
            vectorsUpserted: 0,
            creditsUsed: fetchResult.creditsUsed,
            fromCache: fetchResult.fromCache,
          },
        };
      }

      // ========================================================================
      // Step 2: Chunk ordinances
      // ========================================================================
      const chunkResult = await step.do('chunk-ordinances', async () => {
        console.log(
          `[CityProcessorWorkflow] Chunking ordinances for ${cityConfig.name}`
        );

        const ordinances =
          await state.getRequired<MunicipalOrdinance[]>('ordinances');

        // Use municipal chunk module
        const { chunks } = chunkCity(ordinances, cityConfig);

        // Convert to storage format with metadata
        const allChunks: StoredChunks['chunks'] = [];

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          allChunks.push({
            chunkId: chunk.chunkId,
            text: chunk.text,
            metadata: {
              chunkId: chunk.chunkId,
              sourceId: `municipal-${cityId}-${chunk.chapter}-${chunk.section}`,
              sourceType: 'municipal',
              jurisdiction: `TX-${cityId}`,
              text: chunk.text,
              citation: chunk.citation,
              title: `${cityConfig.name} Code of Ordinances - ${chunk.section}`,
              chunkIndex: i,
              totalChunks: chunks.length,
              category: 'municipal-ordinance',
              indexedAt: new Date().toISOString(),
            },
          });
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
          `[CityProcessorWorkflow] No chunks created for ${cityConfig.name}`
        );
        await state.cleanup();
        return {
          success: true,
          durationMs: Date.now() - startTime,
          data: {
            cityId,
            cityName: cityConfig.name,
            ordinancesProcessed: fetchResult.ordinancesCount,
            chunksCreated: 0,
            vectorsUpserted: 0,
            creditsUsed: fetchResult.creditsUsed,
            fromCache: fetchResult.fromCache,
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
        `[CityProcessorWorkflow] Completed ${cityConfig.name}: ${totalUpserted} vectors in ${durationMs}ms`
      );

      return {
        success: true,
        durationMs,
        data: {
          cityId,
          cityName: cityConfig.name,
          ordinancesProcessed: fetchResult.ordinancesCount,
          chunksCreated: chunkResult.chunksCreated,
          vectorsUpserted: totalUpserted,
          creditsUsed: fetchResult.creditsUsed,
          fromCache: fetchResult.fromCache,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(
        `[CityProcessorWorkflow] Failed ${cityConfig.name}: ${errorMessage}`
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
          cityId,
          cityName: cityConfig.name,
          ordinancesProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
          creditsUsed: 0,
          fromCache: false,
        },
      };
    }
  }
}
