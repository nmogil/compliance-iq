import { Pinecone, type Index, type RecordMetadata } from '@pinecone-database/pinecone';

const INDEX_NAME = 'compliance-embeddings';

/**
 * Metadata schema for regulatory text chunks stored in Pinecone.
 * Enables filtering by jurisdiction, source, and regulatory context.
 *
 * Note: Using type alias instead of interface to avoid index signature conflicts
 * with optional properties.
 */
export type ChunkMetadata = RecordMetadata & {
  /** Unique identifier for the regulatory text chunk */
  chunkId: string;

  /** Source document identifier (e.g., CFR title/part, statute chapter) */
  sourceId: string;

  /** Type of regulatory source */
  sourceType: 'federal' | 'state' | 'county' | 'municipal';

  /** Jurisdiction (e.g., 'US', 'TX', 'Harris County', 'Houston') */
  jurisdiction: string;

  /** Text content of the chunk */
  text: string;

  /** Citation reference (e.g., '21 CFR 117.5', 'Tex. Health & Safety Code § 431.002') */
  citation: string;

  /** Section title or heading (optional) */
  title?: string;

  /** Position of chunk within source document (0-indexed) */
  chunkIndex: number;

  /** Total number of chunks in source document */
  totalChunks: number;

  /** Regulatory topic/category (e.g., 'food-safety', 'building-codes') (optional) */
  category?: string;

  /** ISO 8601 timestamp of when text was indexed */
  indexedAt: string;

  /** ISO 8601 timestamp of last known update to source (optional) */
  lastUpdated?: string;
};

/**
 * Initialize Pinecone client with API key from environment.
 * @param apiKey Pinecone API key
 * @returns Pinecone client instance
 */
export function initPinecone(apiKey: string): Pinecone {
  return new Pinecone({ apiKey });
}

/**
 * Get the compliance embeddings index.
 * @param pc Pinecone client instance
 * @returns Pinecone index for compliance embeddings
 */
export function getIndex(pc: Pinecone): Index<ChunkMetadata> {
  return pc.index<ChunkMetadata>(INDEX_NAME);
}

/**
 * Upsert regulatory text chunks with embeddings into Pinecone.
 * @param index Pinecone index instance
 * @param chunks Array of chunks to upsert
 */
export async function upsertChunks(
  index: Index<ChunkMetadata>,
  chunks: Array<{
    id: string;
    values: number[];
    metadata: ChunkMetadata;
  }>
): Promise<void> {
  // Pinecone recommends batching upserts in groups of 100
  const batchSize = 100;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    await index.upsert(batch);
  }
}

/**
 * Query Pinecone for similar regulatory text chunks.
 * @param index Pinecone index instance
 * @param queryVector Embedding vector for the query
 * @param options Query options
 * @returns Array of matching chunks with scores
 */
export async function queryChunks(
  index: Index<ChunkMetadata>,
  queryVector: number[],
  options: {
    topK?: number;
    filter?: Record<string, unknown>;
    includeMetadata?: boolean;
  } = {}
): Promise<Array<{
  id: string;
  score: number;
  metadata?: ChunkMetadata;
}>> {
  const {
    topK = 10,
    filter = {},
    includeMetadata = true,
  } = options;

  const results = await index.query({
    vector: queryVector,
    topK,
    filter,
    includeMetadata,
  });

  return results.matches.map(match => ({
    id: match.id,
    score: match.score ?? 0,
    metadata: match.metadata as ChunkMetadata | undefined,
  }));
}

/**
 * Delete chunks by ID from Pinecone index.
 * @param index Pinecone index instance
 * @param ids Array of chunk IDs to delete
 */
export async function deleteChunks(
  index: Index<ChunkMetadata>,
  ids: string[]
): Promise<void> {
  await index.deleteMany(ids);
}

/**
 * Delete all chunks matching a metadata filter.
 * Useful for removing all chunks from a specific source or jurisdiction.
 * @param index Pinecone index instance
 * @param filter Metadata filter
 */
export async function deleteByFilter(
  index: Index<ChunkMetadata>,
  filter: Record<string, unknown>
): Promise<void> {
  await index.deleteMany({ filter });
}
