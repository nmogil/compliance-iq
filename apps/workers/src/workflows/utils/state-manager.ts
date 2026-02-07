/**
 * Workflow State Manager
 *
 * R2-based state management for workflows that need to store
 * data larger than the 1 MiB step return limit.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * State manager options
 */
export interface StateManagerOptions {
  /** R2 bucket for state storage */
  bucket: R2Bucket;
  /** Workflow instance ID */
  instanceId: string;
  /** Workflow type for namespacing */
  workflowType: string;
}

/**
 * State manager for a single workflow instance
 */
export class WorkflowStateManager {
  private bucket: R2Bucket;
  private prefix: string;

  constructor(options: StateManagerOptions) {
    this.bucket = options.bucket;
    this.prefix = `workflows/${options.workflowType}/${options.instanceId}`;
  }

  /**
   * Get the key prefix for this workflow instance
   */
  getPrefix(): string {
    return this.prefix;
  }

  /**
   * Store JSON data in R2
   */
  async put<T>(key: string, data: T): Promise<string> {
    const fullKey = `${this.prefix}/${key}.json`;
    await this.bucket.put(fullKey, JSON.stringify(data));
    return fullKey;
  }

  /**
   * Load JSON data from R2
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = `${this.prefix}/${key}.json`;
    const obj = await this.bucket.get(fullKey);
    if (!obj) {
      return null;
    }
    return JSON.parse(await obj.text()) as T;
  }

  /**
   * Load JSON data, throwing if not found
   */
  async getRequired<T>(key: string): Promise<T> {
    const data = await this.get<T>(key);
    if (data === null) {
      throw new Error(`Required state not found: ${this.prefix}/${key}.json`);
    }
    return data;
  }

  /**
   * Store raw content in R2 (e.g., XML)
   */
  async putRaw(key: string, content: string | ArrayBuffer): Promise<string> {
    const fullKey = `${this.prefix}/${key}`;
    await this.bucket.put(fullKey, content);
    return fullKey;
  }

  /**
   * Load raw content from R2
   */
  async getRaw(key: string): Promise<string | null> {
    const fullKey = `${this.prefix}/${key}`;
    const obj = await this.bucket.get(fullKey);
    if (!obj) {
      return null;
    }
    return await obj.text();
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = `${this.prefix}/${key}.json`;
    const obj = await this.bucket.head(fullKey);
    return obj !== null;
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    const fullKey = `${this.prefix}/${key}.json`;
    await this.bucket.delete(fullKey);
  }

  /**
   * List all keys under this workflow instance
   */
  async list(): Promise<string[]> {
    const listed = await this.bucket.list({ prefix: this.prefix });
    return listed.objects.map((obj) => obj.key);
  }

  /**
   * Clean up all state for this workflow instance
   */
  async cleanup(): Promise<number> {
    const keys = await this.list();
    for (const key of keys) {
      await this.bucket.delete(key);
    }
    return keys.length;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a state manager for a workflow instance
 */
export function createStateManager(
  bucket: R2Bucket,
  workflowType: string,
  instanceId: string
): WorkflowStateManager {
  return new WorkflowStateManager({
    bucket,
    instanceId,
    workflowType,
  });
}

// ============================================================================
// Helper Types for Common State Patterns
// ============================================================================

/**
 * Raw fetched content state
 */
export interface FetchedContentState {
  /** R2 key where raw content is stored */
  contentKey: string;
  /** Content type */
  contentType: string;
  /** Size in bytes */
  size: number;
  /** Fetch timestamp */
  fetchedAt: string;
}

/**
 * Parsed content state
 */
export interface ParsedContentState<T> {
  /** Parsed data */
  data: T;
  /** Parse timestamp */
  parsedAt: string;
}

/**
 * Chunk processing state
 */
export interface ChunkProcessingState {
  /** Total chunks to process */
  totalChunks: number;
  /** R2 key where chunks are stored */
  chunksKey: string;
  /** Embedding batch count */
  embedBatchCount: number;
  /** Upsert batch count */
  upsertBatchCount: number;
  /** Completed embedding batches */
  completedEmbedBatches: number[];
  /** Completed upsert batches */
  completedUpsertBatches: number[];
}

/**
 * Workflow completion state
 */
export interface CompletionState {
  /** Success flag */
  success: boolean;
  /** Total vectors upserted */
  vectorsUpserted: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Completion timestamp */
  completedAt: string;
  /** Error message if failed */
  error?: string;
}
