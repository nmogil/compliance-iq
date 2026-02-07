/**
 * Cloudflare Workflows Types
 *
 * Shared types for workflow parameters, results, and state management.
 * Implements the coordinator-worker pattern for handling large pipelines.
 */

// ============================================================================
// Cloudflare Workflow Runtime Types
// These types match the Cloudflare Workers runtime bindings but are defined
// here since they're not available at compile time from 'cloudflare:workers'
// ============================================================================

/**
 * Workflow instance returned from create() or get()
 */
export interface WorkflowInstance {
  /** Unique instance identifier */
  id: string;
  /** Pause workflow execution */
  pause(): Promise<void>;
  /** Resume paused workflow */
  resume(): Promise<void>;
  /** Terminate workflow */
  terminate(): Promise<void>;
  /** Restart workflow from the beginning */
  restart(): Promise<void>;
  /** Get current workflow status */
  status(): Promise<WorkflowStatus>;
}

/**
 * Workflow status returned from instance.status()
 */
export interface WorkflowStatus {
  /** Current execution status */
  status: 'queued' | 'running' | 'paused' | 'complete' | 'errored' | 'terminated';
  /** Error details if errored */
  error?: { name: string; message: string };
  /** Output if complete */
  output?: unknown;
}

/**
 * Workflow binding type for Env interface
 * Matches Cloudflare's runtime Workflow binding
 */
export interface Workflow<Params = unknown> {
  /** Create a new workflow instance */
  create(options?: { id?: string; params?: Params }): Promise<WorkflowInstance>;
  /** Get an existing workflow instance by ID */
  get(id: string): Promise<WorkflowInstance>;
}

// ============================================================================
// Common Workflow Types
// ============================================================================

/**
 * Base parameters for all workflow invocations
 */
export interface BaseWorkflowParams {
  /** Optional run ID for tracking */
  runId?: string;
  /** Feature flag to use workflows */
  useWorkflows?: boolean;
}

/**
 * Common result structure for all workflows
 */
export interface WorkflowResult {
  /** Whether the workflow completed successfully */
  success: boolean;
  /** Processing duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  error?: string;
  /** Additional result data */
  data?: Record<string, unknown>;
}

/**
 * Progress tracking for batch workflows
 */
export interface BatchProgress {
  /** Total items to process */
  total: number;
  /** Items completed */
  completed: number;
  /** Items failed */
  failed: number;
  /** Items in progress */
  inProgress: number;
}

// ============================================================================
// Federal Workflow Types
// ============================================================================

/**
 * Parameters for FederalBatchWorkflow (coordinator)
 */
export interface FederalBatchParams extends BaseWorkflowParams {
  /** Optional list of titles to process (defaults to all enabled) */
  titles?: number[];
}

/**
 * Result from FederalBatchWorkflow
 */
export interface FederalBatchResult extends WorkflowResult {
  data?: {
    titlesProcessed: number;
    totalChunks: number;
    totalVectors: number;
    childWorkflowIds: string[];
  };
}

/**
 * Parameters for FederalTitleWorkflow (worker)
 */
export interface FederalTitleParams extends BaseWorkflowParams {
  /** CFR title number to process */
  titleNumber: number;
  /** Parent batch workflow instance ID (for tracking) */
  parentInstanceId?: string;
}

/**
 * Result from FederalTitleWorkflow
 */
export interface FederalTitleResult extends WorkflowResult {
  data?: {
    titleNumber: number;
    partsProcessed: number;
    chunksCreated: number;
    vectorsUpserted: number;
  };
}

// ============================================================================
// Texas Workflow Types
// ============================================================================

/**
 * Parameters for TexasBatchWorkflow (coordinator)
 */
export interface TexasBatchParams extends BaseWorkflowParams {
  /** Process statutes only */
  statutesOnly?: boolean;
  /** Process TAC only */
  tacOnly?: boolean;
  /** Optional list of statute codes to process */
  statuteCodes?: string[];
  /** Optional list of TAC title numbers to process */
  tacTitles?: number[];
}

/**
 * Result from TexasBatchWorkflow
 */
export interface TexasBatchResult extends WorkflowResult {
  data?: {
    statutesProcessed: number;
    tacTitlesProcessed: number;
    totalChunks: number;
    totalVectors: number;
    childWorkflowIds: string[];
  };
}

/**
 * Parameters for TexasCodeWorkflow (worker - statutes)
 */
export interface TexasCodeParams extends BaseWorkflowParams {
  /** Texas statute code abbreviation (e.g., "PE", "HS") */
  codeAbbreviation: string;
  /** Parent batch workflow instance ID */
  parentInstanceId?: string;
}

/**
 * Result from TexasCodeWorkflow
 */
export interface TexasCodeResult extends WorkflowResult {
  data?: {
    codeAbbreviation: string;
    sectionsProcessed: number;
    chunksCreated: number;
    vectorsUpserted: number;
  };
}

/**
 * Parameters for TexasTACWorkflow (worker - TAC)
 */
export interface TexasTACParams extends BaseWorkflowParams {
  /** TAC title number */
  tacTitleNumber: number;
  /** Parent batch workflow instance ID */
  parentInstanceId?: string;
}

/**
 * Result from TexasTACWorkflow
 */
export interface TexasTACResult extends WorkflowResult {
  data?: {
    tacTitleNumber: number;
    rulesProcessed: number;
    chunksCreated: number;
    vectorsUpserted: number;
  };
}

// ============================================================================
// County Workflow Types
// ============================================================================

/**
 * Parameters for CountyBatchWorkflow (coordinator)
 */
export interface CountyBatchParams extends BaseWorkflowParams {
  /** Optional list of county names to process */
  countyNames?: string[];
}

/**
 * Result from CountyBatchWorkflow
 */
export interface CountyBatchResult extends WorkflowResult {
  data?: {
    countiesProcessed: number;
    totalChunks: number;
    totalVectors: number;
    childWorkflowIds: string[];
  };
}

/**
 * Parameters for CountyProcessorWorkflow (worker)
 */
export interface CountyProcessorParams extends BaseWorkflowParams {
  /** County name */
  countyName: string;
  /** County FIPS code */
  fipsCode: string;
  /** Parent batch workflow instance ID */
  parentInstanceId?: string;
}

/**
 * Result from CountyProcessorWorkflow
 */
export interface CountyProcessorResult extends WorkflowResult {
  data?: {
    countyName: string;
    ordinancesProcessed: number;
    chunksCreated: number;
    vectorsUpserted: number;
  };
}

// ============================================================================
// Municipal Workflow Types
// ============================================================================

/**
 * Parameters for MunicipalBatchWorkflow (coordinator)
 */
export interface MunicipalBatchParams extends BaseWorkflowParams {
  /** Optional list of city IDs to process */
  cityIds?: string[];
  /** Skip cache and force fresh scrape */
  skipCache?: boolean;
}

/**
 * Result from MunicipalBatchWorkflow
 */
export interface MunicipalBatchResult extends WorkflowResult {
  data?: {
    citiesProcessed: number;
    totalChunks: number;
    totalVectors: number;
    totalCreditsUsed: number;
    childWorkflowIds: string[];
  };
}

/**
 * Parameters for CityProcessorWorkflow (worker)
 */
export interface CityProcessorParams extends BaseWorkflowParams {
  /** City ID */
  cityId: string;
  /** Skip cache and force fresh scrape */
  skipCache?: boolean;
  /** Parent batch workflow instance ID */
  parentInstanceId?: string;
}

/**
 * Result from CityProcessorWorkflow
 */
export interface CityProcessorResult extends WorkflowResult {
  data?: {
    cityId: string;
    cityName: string;
    ordinancesProcessed: number;
    chunksCreated: number;
    vectorsUpserted: number;
    creditsUsed: number;
    fromCache: boolean;
  };
}

// ============================================================================
// Workflow State Types (for R2 storage)
// ============================================================================

/**
 * Intermediate state stored in R2 during workflow execution
 */
export interface WorkflowState<T = unknown> {
  /** Workflow instance ID */
  instanceId: string;
  /** Workflow type */
  workflowType: string;
  /** Current phase of execution */
  phase: 'fetch' | 'parse' | 'chunk' | 'embed' | 'upsert' | 'complete';
  /** State data */
  data: T;
  /** Last updated timestamp */
  updatedAt: string;
}

/**
 * Chunks stored in R2 for embedding
 */
export interface StoredChunks {
  /** Array of chunks with text and metadata */
  chunks: Array<{
    chunkId: string;
    text: string;
    metadata: Record<string, unknown>;
  }>;
  /** Total count */
  count: number;
}

/**
 * Embeddings stored in R2 for upsert
 */
export interface StoredEmbeddings {
  /** Array of chunk IDs with embeddings */
  embeddings: Array<{
    chunkId: string;
    values: number[];
  }>;
  /** Total count */
  count: number;
}

// ============================================================================
// Step Configuration Types
// ============================================================================

/**
 * Retry configuration for workflow steps
 */
export interface StepRetryConfig {
  /** Maximum number of retry attempts */
  limit: number;
  /** Backoff strategy */
  backoff?: 'constant' | 'linear' | 'exponential';
  /** Initial delay in milliseconds */
  delay?: number;
}

/**
 * Default retry configurations for different step types
 */
export const DEFAULT_RETRY_CONFIGS = {
  /** API calls (eCFR, TAC, etc.) */
  fetch: { limit: 3, backoff: 'exponential' as const, delay: 1000 },
  /** OpenAI embedding API calls */
  embed: { limit: 4, backoff: 'exponential' as const, delay: 1000 },
  /** Pinecone upsert calls */
  upsert: { limit: 3, backoff: 'exponential' as const, delay: 500 },
  /** R2 storage operations */
  storage: { limit: 2, backoff: 'constant' as const, delay: 500 },
};

// ============================================================================
// Workflow Binding Types (for Env interface)
// ============================================================================

/**
 * Workflow bindings to add to Env interface
 */
export interface WorkflowBindings {
  // Federal
  FEDERAL_BATCH_WORKFLOW: Workflow<FederalBatchParams>;
  FEDERAL_TITLE_WORKFLOW: Workflow<FederalTitleParams>;
  // Texas
  TEXAS_BATCH_WORKFLOW: Workflow<TexasBatchParams>;
  TEXAS_CODE_WORKFLOW: Workflow<TexasCodeParams>;
  TEXAS_TAC_WORKFLOW: Workflow<TexasTACParams>;
  // Counties
  COUNTY_BATCH_WORKFLOW: Workflow<CountyBatchParams>;
  COUNTY_PROCESSOR_WORKFLOW: Workflow<CountyProcessorParams>;
  // Municipal
  MUNICIPAL_BATCH_WORKFLOW: Workflow<MunicipalBatchParams>;
  CITY_PROCESSOR_WORKFLOW: Workflow<CityProcessorParams>;
}

// ============================================================================
// HTTP Response Types
// ============================================================================

/**
 * Response returned when triggering a workflow via HTTP
 */
export interface WorkflowTriggerResponse {
  /** Workflow instance ID */
  instanceId: string;
  /** Workflow type */
  workflowType: string;
  /** Initial status */
  status: 'queued' | 'running';
  /** URL to check status */
  statusUrl: string;
  /** Timestamp of trigger */
  triggeredAt: string;
}

/**
 * Response from workflow status endpoint
 */
export interface WorkflowStatusResponse {
  /** Workflow instance ID */
  instanceId: string;
  /** Workflow type */
  workflowType: string;
  /** Current status */
  status: 'queued' | 'running' | 'paused' | 'complete' | 'failed' | 'errored';
  /** Output if complete */
  output?: WorkflowResult;
  /** Error details if failed */
  error?: {
    name: string;
    message: string;
  };
  /** Progress information */
  progress?: BatchProgress;
}
