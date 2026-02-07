/**
 * FederalTitleWorkflow
 *
 * Worker workflow that processes a single CFR title through the full pipeline:
 * 1. Read pre-parsed data from R2 cache (avoids CPU-intensive XML parsing)
 * 2. Chunk sections for embedding
 * 3. Generate embeddings in batches
 * 4. Upsert vectors to Pinecone in batches
 *
 * IMPORTANT: This workflow requires pre-cached CFR data in R2.
 * Run `POST /cache/federal/refresh/:title` before triggering the workflow.
 *
 * Uses R2 for intermediate state to stay under 1 MiB step return limit.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import type { Env } from '../../types';
import type {
  FederalTitleParams,
  FederalTitleResult,
  StoredChunks,
} from '../types';
import {
  getEmbedBatchCount,
  getUpsertBatchCount,
  EMBED_BATCH_SIZE,
  UPSERT_BATCH_SIZE,
} from '../utils/constants';
import { createStateManager } from '../utils/state-manager';
import { getCachedPart, getTitleManifest } from '../../federal/cache-read';
import { getCategoriesForTitle } from '../../federal/types';
import type { CFRPart, CFRSection } from '../../federal/types';
// Note: chunkCFRPart, OpenAI, and Pinecone are dynamically imported
// to avoid loading heavy dependencies at startup (prevents CPU limit)

/**
 * FederalTitleWorkflow - Process a single CFR title
 *
 * @example
 * ```typescript
 * const instance = await env.FEDERAL_TITLE_WORKFLOW.create({
 *   params: { titleNumber: 21 }
 * });
 * ```
 */
export class FederalTitleWorkflow extends WorkflowEntrypoint<
  Env,
  FederalTitleParams
> {
  override async run(
    event: WorkflowEvent<FederalTitleParams>,
    step: WorkflowStep
  ): Promise<FederalTitleResult> {
    const startTime = Date.now();
    const { titleNumber, parentInstanceId: _parentInstanceId } = event.payload;
    const instanceId = event.instanceId;

    console.log(
      `[FederalTitleWorkflow] Starting title ${titleNumber} (instance: ${instanceId})`
    );

    // Create state manager for this instance
    const state = createStateManager(
      this.env.DOCUMENTS_BUCKET,
      'federal-title',
      instanceId
    );

    try {
      // ========================================================================
      // Step 1: Get title structure (from cache manifest or API)
      // ========================================================================
      const structureResult = await step.do(
        'get-structure',
        { retries: { limit: 3, backoff: 'exponential', delay: 1000 } },
        async () => {
          console.log(`[FederalTitleWorkflow] Getting structure for title ${titleNumber}`);

          // Get parts list from cache manifest (required)
          const manifest = await getTitleManifest(this.env.DOCUMENTS_BUCKET, titleNumber);
          if (!manifest || manifest.parts.length === 0) {
            throw new Error(
              `No cached data for title ${titleNumber}. ` +
              `Run POST /cache/federal/refresh/${titleNumber} first.`
            );
          }

          console.log(`[FederalTitleWorkflow] Using cached manifest (${manifest.parts.length} parts)`);
          const parts = manifest.parts.map(p => p.partNumber);
          await state.put('structure', { parts });

          return {
            partsCount: parts.length,
            parts,
            titleName: manifest.titleName,
          };
        }
      );

      console.log(
        `[FederalTitleWorkflow] Found ${structureResult.partsCount} parts in title ${titleNumber} (from cache)`
      );

      // ========================================================================
      // Step 2: Process each part from cache (no XML parsing - avoids CPU limits)
      // Store chunks to R2 within each step to avoid 1 MiB return limit
      // ========================================================================
      let totalChunks = 0;
      let totalSections = 0;

      for (let partIdx = 0; partIdx < structureResult.parts.length; partIdx++) {
        const partNumber = structureResult.parts[partIdx]!;

        // Process each part in its own step
        // Read from R2 cache instead of parsing XML (avoids CPU limits)
        const partResult = await step.do(
          `process-part-${partNumber}`,
          { retries: { limit: 3, backoff: 'exponential', delay: 1000 } },
          async () => {
            console.log(`[FederalTitleWorkflow] Processing part ${partNumber} from cache`);

            // Read pre-parsed data from cache
            const cached = await getCachedPart(
              this.env.DOCUMENTS_BUCKET,
              titleNumber,
              partNumber
            );

            if (!cached) {
              throw new Error(
                `Cache miss: title ${titleNumber} part ${partNumber}. ` +
                `Run POST /cache/federal/refresh/${titleNumber} first.`
              );
            }

            // Get category for this title
            const categories = getCategoriesForTitle(titleNumber);
            const category = categories[0];

            // Use cached sections directly (already in correct format)
            const sections: CFRSection[] = cached.sections;
            const sectionsCount = sections.length;

            const part: CFRPart = {
              number: cached.partNumber,
              name: cached.partName,
              sections,
            };

            // Dynamically import chunkCFRPart to avoid loading tiktoken at startup
            const { chunkCFRPart } = await import('../../federal/chunk');

            // Generate chunks for this part
            const chunks = chunkCFRPart(part, {
              titleNumber,
              titleName: cached.titleName,
              chapter: 'I',
              category,
            });

            // Convert to storage format with metadata (filter empty chunks)
            const partChunks: StoredChunks['chunks'] = [];
            for (const chunk of chunks) {
              // Skip chunks with empty text (OpenAI won't embed them)
              if (!chunk.text || chunk.text.trim().length === 0) {
                console.warn(`[FederalTitleWorkflow] Skipping empty chunk: ${chunk.chunkId}`);
                continue;
              }
              partChunks.push({
                chunkId: chunk.chunkId,
                text: chunk.text,
                metadata: {
                  chunkId: chunk.chunkId,
                  sourceId: chunk.sourceId,
                  sourceType: 'federal',
                  jurisdiction: 'US',
                  text: chunk.text,
                  citation: chunk.citation,
                  chunkIndex: chunk.chunkIndex,
                  totalChunks: chunk.totalChunks,
                  ...(chunk.category ? { category: chunk.category } : {}),
                  indexedAt: new Date().toISOString(),
                },
              });
            }

            // Store chunks for this part in R2 (avoid 1 MiB return limit)
            await state.put(`part-chunks-${partNumber}`, {
              chunks: partChunks,
              count: partChunks.length,
            });

            console.log(
              `[FederalTitleWorkflow] Part ${partNumber}: ${sectionsCount} sections, ${partChunks.length} chunks (from cache)`
            );

            // Return only counts, not the full chunk array
            return {
              partNumber,
              sectionsCount,
              chunksCount: partChunks.length,
            };
          }
        );

        totalChunks += partResult.chunksCount;
        totalSections += partResult.sectionsCount;
      }

      // ========================================================================
      // Step 3: Merge all part chunks into a single chunks file
      // ========================================================================
      const mergeResult = await step.do('merge-chunks', async () => {
        const allChunks: StoredChunks['chunks'] = [];

        // Load chunks from each part
        for (const partNumber of structureResult.parts) {
          const partData = await state.get<StoredChunks>(`part-chunks-${partNumber}`);
          if (partData) {
            allChunks.push(...partData.chunks);
          }
        }

        // Store merged chunks
        await state.put('chunks', { chunks: allChunks, count: allChunks.length });

        // Clean up part-specific chunk files
        for (const partNumber of structureResult.parts) {
          await state.delete(`part-chunks-${partNumber}`);
        }

        return { merged: allChunks.length };
      });

      const chunkResult = {
        chunksCreated: mergeResult.merged,
        embedBatchCount: getEmbedBatchCount(mergeResult.merged),
        upsertBatchCount: getUpsertBatchCount(mergeResult.merged),
      };

      console.log(
        `[FederalTitleWorkflow] Created ${chunkResult.chunksCreated} chunks from ${totalSections} sections (${chunkResult.embedBatchCount} embed batches, ${chunkResult.upsertBatchCount} upsert batches)`
      );

      // ========================================================================
      // Step 4: Embed chunks in batches
      // ========================================================================
      let totalEmbedded = 0;

      for (let i = 0; i < chunkResult.embedBatchCount; i++) {
        const embeddedCount = await step.do(
          `embed-batch-${i}`,
          { retries: { limit: 4, backoff: 'exponential', delay: 1000 } },
          async () => {
            // Load chunks
            const { chunks } = await state.getRequired<StoredChunks>('chunks');

            // Calculate batch range
            const startIdx = i * EMBED_BATCH_SIZE;
            const endIdx = Math.min(startIdx + EMBED_BATCH_SIZE, chunks.length);
            const batchChunks = chunks.slice(startIdx, endIdx);

            if (batchChunks.length === 0) return 0;

            // Filter out chunks with empty text (OpenAI rejects empty strings)
            const validChunks = batchChunks.filter(c => c.text && c.text.trim().length > 0);
            if (validChunks.length === 0) {
              console.warn(`[FederalTitleWorkflow] Embed batch ${i}: all chunks empty, skipping`);
              return 0;
            }

            // Import OpenAI dynamically to avoid initialization issues
            const { default: OpenAI } = await import('openai');
            const openai = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });

            // Generate embeddings
            const texts = validChunks.map((c) => c.text);
            const response = await openai.embeddings.create({
              model: 'text-embedding-3-large',
              input: texts,
              encoding_format: 'float',
            });

            // Store embeddings
            const embeddings = response.data.map((d, idx) => ({
              chunkId: validChunks[idx]!.chunkId,
              values: d.embedding,
            }));

            await state.put(`embeddings-${i}`, {
              embeddings,
              count: embeddings.length,
            });

            console.log(
              `[FederalTitleWorkflow] Embedded batch ${i}: ${embeddings.length} chunks`
            );

            return embeddings.length;
          }
        );

        totalEmbedded += embeddedCount;
      }

      console.log(
        `[FederalTitleWorkflow] Total embedded: ${totalEmbedded} chunks`
      );

      // ========================================================================
      // Step 5: Upsert vectors to Pinecone in batches
      // ========================================================================
      let totalUpserted = 0;

      for (let i = 0; i < chunkResult.upsertBatchCount; i++) {
        const upsertedCount = await step.do(
          `upsert-batch-${i}`,
          { retries: { limit: 3, backoff: 'exponential', delay: 500 } },
          async () => {
            // Load chunks (for metadata)
            const { chunks } = await state.getRequired<StoredChunks>('chunks');

            // Calculate batch range
            const startIdx = i * UPSERT_BATCH_SIZE;
            const endIdx = Math.min(startIdx + UPSERT_BATCH_SIZE, chunks.length);
            const batchChunks = chunks.slice(startIdx, endIdx);

            if (batchChunks.length === 0) return 0;

            // Determine which embedding batches we need
            const firstEmbedBatch = Math.floor(startIdx / EMBED_BATCH_SIZE);
            const lastEmbedBatch = Math.floor((endIdx - 1) / EMBED_BATCH_SIZE);

            // Load required embedding batches
            const allEmbeddings: Array<{ chunkId: string; values: number[] }> =
              [];
            for (let eb = firstEmbedBatch; eb <= lastEmbedBatch; eb++) {
              const embedData = await state.getRequired<{
                embeddings: Array<{ chunkId: string; values: number[] }>;
              }>(`embeddings-${eb}`);
              allEmbeddings.push(...embedData.embeddings);
            }

            // Map embeddings by chunk ID
            const embeddingMap = new Map(
              allEmbeddings.map((e) => [e.chunkId, e.values])
            );

            // Build vectors
            const vectors = batchChunks.map((chunk) => {
              const values = embeddingMap.get(chunk.chunkId);
              if (!values) {
                throw new Error(`Missing embedding: ${chunk.chunkId}`);
              }
              return {
                id: chunk.chunkId,
                values,
                metadata: chunk.metadata as Record<string, unknown>,
              };
            });

            // Import Pinecone dynamically
            const { Pinecone } = await import('@pinecone-database/pinecone');
            const pinecone = new Pinecone({ apiKey: this.env.PINECONE_API_KEY });
            const index = pinecone.index('compliance-embeddings');

            await index.upsert(vectors);

            console.log(
              `[FederalTitleWorkflow] Upserted batch ${i}: ${vectors.length} vectors`
            );

            return vectors.length;
          }
        );

        totalUpserted += upsertedCount;
      }

      console.log(
        `[FederalTitleWorkflow] Total upserted: ${totalUpserted} vectors`
      );

      // ========================================================================
      // Step 6: Cleanup and return result
      // ========================================================================
      await step.do('cleanup', async () => {
        // Clean up workflow state from R2
        const cleaned = await state.cleanup();
        console.log(`[FederalTitleWorkflow] Cleaned up ${cleaned} state files`);
        return cleaned;
      });

      const durationMs = Date.now() - startTime;

      console.log(
        `[FederalTitleWorkflow] Completed title ${titleNumber}: ${totalUpserted} vectors in ${durationMs}ms`
      );

      return {
        success: true,
        durationMs,
        data: {
          titleNumber,
          partsProcessed: structureResult.partsCount,
          chunksCreated: chunkResult.chunksCreated,
          vectorsUpserted: totalUpserted,
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(
        `[FederalTitleWorkflow] Failed title ${titleNumber}: ${errorMessage}`
      );

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
          titleNumber,
          partsProcessed: 0,
          chunksCreated: 0,
          vectorsUpserted: 0,
        },
      };
    }
  }
}
