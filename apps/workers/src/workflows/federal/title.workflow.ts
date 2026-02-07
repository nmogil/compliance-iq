/**
 * FederalTitleWorkflow
 *
 * Worker workflow that processes a single CFR title through the full pipeline:
 * 1. Fetch XML from eCFR API
 * 2. Parse XML into parts/sections
 * 3. Chunk sections for embedding
 * 4. Generate embeddings in batches
 * 5. Upsert vectors to Pinecone in batches
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
} from '../utils/step-helpers';
import { createStateManager } from '../utils/state-manager';
import { fetchCFRTitleStructure, fetchCFRPart, parseCFRXML } from '../../federal/fetch';
import { chunkCFRPart } from '../../federal/chunk';
import { getCategoriesForTitle } from '../../federal/types';
import type { CFRPart, CFRSection } from '../../federal/types';
import type { RecordMetadata } from '@pinecone-database/pinecone';

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
      // Step 1: Get title structure (part list)
      // ========================================================================
      const structureResult = await step.do(
        'get-structure',
        { retries: { limit: 3, backoff: 'exponential', delay: 1000 } },
        async () => {
          console.log(`[FederalTitleWorkflow] Getting structure for title ${titleNumber}`);
          const structure = await fetchCFRTitleStructure(titleNumber);

          // Store part list in R2
          await state.put('structure', structure);

          return {
            partsCount: structure.parts.length,
            parts: structure.parts,
          };
        }
      );

      console.log(
        `[FederalTitleWorkflow] Found ${structureResult.partsCount} parts in title ${titleNumber}`
      );

      // NOTE: Cloudflare Workflows have strict CPU limits that may cause XML parsing
      // to fail for larger parts. If this is an issue, consider:
      // 1. Using Cloudflare Queues for CPU-intensive work
      // 2. Offloading parsing to an external service
      // 3. Using regex-based extraction instead of full XML parsing

      // ========================================================================
      // Step 2: Process each part (fetch, parse, chunk) in separate steps
      // Store chunks to R2 within each step to avoid 1 MiB return limit
      // ========================================================================
      let totalChunks = 0;
      let totalSections = 0;

      for (let partIdx = 0; partIdx < structureResult.parts.length; partIdx++) {
        const partNumber = structureResult.parts[partIdx]!;

        // Process each part in its own step (smaller XML, less CPU)
        // Store chunks directly to R2 within step to avoid return limit
        const partResult = await step.do(
          `process-part-${partNumber}`,
          { retries: { limit: 3, backoff: 'exponential', delay: 1000 } },
          async () => {
            console.log(`[FederalTitleWorkflow] Processing part ${partNumber}`);

            // Fetch part XML (smaller than full title)
            const xml = await fetchCFRPart(titleNumber, partNumber);

            // Parse XML into structured format
            const parsed = parseCFRXML(xml);

            // Get category for this title
            const categories = getCategoriesForTitle(titleNumber);
            const category = categories[0];

            // Chunk all sections in this part
            const partChunks: StoredChunks['chunks'] = [];
            let sectionsCount = 0;

            for (const parsedPart of parsed.parts) {
              // Convert parsed sections to expected format
              const sections: CFRSection[] = parsedPart.sections.map((s) => ({
                number: s.number,
                title: s.heading,
                text: s.text,
                subsections: s.subsections,
                effectiveDate: s.effectiveDate,
                lastAmended: s.lastAmended,
              }));

              sectionsCount += sections.length;

              const part: CFRPart = {
                number: parsedPart.number,
                name: parsedPart.name,
                sections,
              };

              // Generate chunks for this part
              const chunks = chunkCFRPart(part, {
                titleNumber,
                titleName: parsed.name,
                chapter: 'I',
                category,
              });

              // Convert to storage format with metadata
              for (const chunk of chunks) {
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
            }

            // Store chunks for this part in R2 (avoid 1 MiB return limit)
            await state.put(`part-chunks-${partNumber}`, {
              chunks: partChunks,
              count: partChunks.length,
            });

            console.log(
              `[FederalTitleWorkflow] Part ${partNumber}: ${sectionsCount} sections, ${partChunks.length} chunks`
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

            // Import OpenAI dynamically to avoid initialization issues
            const { default: OpenAI } = await import('openai');
            const openai = new OpenAI({ apiKey: this.env.OPENAI_API_KEY });

            // Generate embeddings
            const texts = batchChunks.map((c) => c.text);
            const response = await openai.embeddings.create({
              model: 'text-embedding-3-large',
              input: texts,
              encoding_format: 'float',
            });

            // Store embeddings
            const embeddings = response.data.map((d, idx) => ({
              chunkId: batchChunks[idx]!.chunkId,
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
                metadata: chunk.metadata as RecordMetadata,
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
