/**
 * TexasCodeWorkflow
 *
 * Worker workflow that processes a single Texas statute code through the full pipeline:
 * 1. Fetch statute sections from Texas Legislature
 * 2. Parse into sections
 * 3. Chunk sections for embedding
 * 4. Generate embeddings in batches
 * 5. Upsert vectors to Pinecone in batches
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from '../../types';
import type { TexasCodeParams, TexasCodeResult, StoredChunks } from '../types';
import {
  getEmbedBatchCount,
  getUpsertBatchCount,
  EMBED_BATCH_SIZE,
  UPSERT_BATCH_SIZE,
} from '../utils/step-helpers';
import { createStateManager } from '../utils/state-manager';
import { fetchTexasCode } from '../../texas/fetch-statutes';
import { chunkTexasStatute, type TexasChunkContext } from '../../texas/chunk';
import { TARGET_STATUTES, type TexasStatuteSection } from '../../texas/types';
import type { RecordMetadata } from '@pinecone-database/pinecone';

/**
 * TexasCodeWorkflow - Process a single Texas statute code
 *
 * @example
 * ```typescript
 * const instance = await env.TEXAS_CODE_WORKFLOW.create({
 *   params: { codeAbbreviation: 'PE' }
 * });
 * ```
 */
export class TexasCodeWorkflow extends WorkflowEntrypoint<Env, TexasCodeParams> {
  override async run(
    event: WorkflowEvent<TexasCodeParams>,
    step: WorkflowStep
  ): Promise<TexasCodeResult> {
    const startTime = Date.now();
    const { codeAbbreviation, parentInstanceId: _parentInstanceId } = event.payload;
    const instanceId = event.instanceId;

    console.log(
      `[TexasCodeWorkflow] Starting code ${codeAbbreviation} (instance: ${instanceId})`
    );

    // Find code config
    const codeConfig = TARGET_STATUTES.find(
      (c) => c.abbreviation === codeAbbreviation
    );
    if (!codeConfig) {
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: `Unknown code: ${codeAbbreviation}`,
        data: {
          codeAbbreviation,
          sectionsProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
        },
      };
    }

    // Create state manager
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'texas-code',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Fetch statute sections
      // ========================================================================
      const fetchResult = await step.do(
        'fetch-sections',
        { retries: { limit: 3, backoff: 'exponential', delay: 1000 } },
        async () => {
          console.log(`[TexasCodeWorkflow] Fetching ${codeAbbreviation}`);

          const sections: TexasStatuteSection[] = [];
          for await (const section of fetchTexasCode(codeConfig)) {
            sections.push(section);
          }

          // Store sections in R2
          await state.put('sections', sections);

          console.log(
            `[TexasCodeWorkflow] Fetched ${sections.length} sections for ${codeAbbreviation}`
          );

          return {
            sectionsCount: sections.length,
            fetchedAt: new Date().toISOString(),
          };
        }
      );

      if (fetchResult.sectionsCount === 0) {
        console.log(
          `[TexasCodeWorkflow] No sections found for ${codeAbbreviation}`
        );
        await state.cleanup();
        return {
          success: true,
          durationMs: Date.now() - startTime,
          data: {
            codeAbbreviation,
            sectionsProcessed: 0,
            chunksCreated: 0,
            vectorsUpserted: 0,
          },
        };
      }

      // ========================================================================
      // Step 2: Chunk sections
      // ========================================================================
      const chunkResult = await step.do('chunk-sections', async () => {
        console.log(`[TexasCodeWorkflow] Chunking ${codeAbbreviation}`);

        const sections = await state.getRequired<TexasStatuteSection[]>('sections');
        const category = codeConfig.categories[0];

        const allChunks: StoredChunks['chunks'] = [];

        for (const section of sections) {
          const context: TexasChunkContext = {
            code: codeAbbreviation,
            codeName: codeConfig.name,
            chapter: section.chapter,
            category,
          };

          const chunks = chunkTexasStatute(section, context);

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
          `[TexasCodeWorkflow] No chunks created for ${codeAbbreviation}`
        );
        await state.cleanup();
        return {
          success: true,
          durationMs: Date.now() - startTime,
          data: {
            codeAbbreviation,
            sectionsProcessed: fetchResult.sectionsCount,
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
        `[TexasCodeWorkflow] Completed ${codeAbbreviation}: ${totalUpserted} vectors in ${durationMs}ms`
      );

      return {
        success: true,
        durationMs,
        data: {
          codeAbbreviation,
          sectionsProcessed: fetchResult.sectionsCount,
          chunksCreated: chunkResult.chunksCreated,
          vectorsUpserted: totalUpserted,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(
        `[TexasCodeWorkflow] Failed ${codeAbbreviation}: ${errorMessage}`
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
          codeAbbreviation,
          sectionsProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
        },
      };
    }
  }
}
