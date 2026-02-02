/**
 * County Data Pipeline Types
 *
 * TypeScript interfaces for Texas county ordinances, court orders,
 * source configuration, and pipeline management.
 *
 * Key Insight: Texas counties have limited ordinance-making authority
 * compared to municipalities. Many counties operate primarily through
 * commissioners court orders rather than comprehensive ordinance codes.
 */

/**
 * CountySubsection - Subdivision within an ordinance section
 * Example: (a), (a)(1), (b)(2)(A)
 */
export interface CountySubsection {
  /** Subsection identifier (e.g., "(a)", "(a)(1)") */
  id: string;
  /** Subsection text content */
  text: string;
}

/**
 * CountyOrdinance - Individual ordinance/section from codified code
 *
 * Used for counties with codified ordinance databases on platforms
 * like Municode, eLaws, or American Legal Publishing.
 */
export interface CountyOrdinance {
  /** County name (e.g., "Harris", "Dallas") */
  county: string;

  /** FIPS code for county (e.g., "48201" for Harris County) */
  fipsCode: string;

  /** Chapter number or identifier */
  chapter: string;

  /** Section number within chapter */
  section: string;

  /** Section heading/title */
  heading: string;

  /** Full text content of the section */
  text: string;

  /** Subsections (if any) */
  subsections?: CountySubsection[];

  /** Direct URL to source document */
  sourceUrl: string;

  /** ISO 8601 timestamp when scraped */
  scrapedAt: string;
}

/**
 * CourtOrder - Commissioner court order
 *
 * For counties without codified ordinance databases. Many Texas counties
 * publish regulations as individual court orders in meeting minutes rather
 * than searchable ordinance codes.
 */
export interface CourtOrder {
  /** County name (e.g., "Tarrant") */
  county: string;

  /** FIPS code for county */
  fipsCode: string;

  /** Order number/identifier */
  orderNumber: string;

  /** ISO 8601 date when order was adopted */
  adoptionDate: string;

  /** Order title/subject */
  title: string;

  /** Full text content of the order */
  text: string;

  /** Direct URL to source document */
  sourceUrl: string;

  /** ISO 8601 timestamp when scraped */
  scrapedAt: string;
}

/**
 * Platform types for county ordinance publishing
 *
 * - 'municode': Municode Library (library.municode.com) - SPA, may need API access
 * - 'elaws': eLaws platform (*.elaws.us) - Server-rendered HTML
 * - 'amlegal': American Legal Publishing (codelibrary.amlegal.com) - Blocks AI crawlers
 * - 'custom': County-specific website with unique structure
 * - 'court-orders': No codified ordinances, only commissioners court orders
 */
export type CountyPlatform =
  | 'municode'
  | 'elaws'
  | 'amlegal'
  | 'custom'
  | 'court-orders';

/**
 * CountySourceConfig - Registry entry for a county
 *
 * Defines source availability, platform type, and processing status
 * for each target county.
 */
export interface CountySourceConfig {
  /** County name (e.g., "Harris", "Dallas") */
  name: string;

  /** FIPS code for county (for geocoding integration) */
  fipsCode: string;

  /** Source platform (if online source exists) */
  platform?: CountyPlatform;

  /** Base URL for ordinance source (if exists) */
  baseUrl?: string;

  /** Whether this county has accessible online ordinances */
  hasOnlineSource: boolean;

  /** Whether to process this county (false = skip and document gap) */
  enabled: boolean;

  /** Reason if not enabled (for coverage documentation) */
  skipReason?: string;

  /**
   * Regulatory categories this county covers
   *
   * County authority is generally restricted to:
   * - subdivision: Subdivision regulations
   * - zoning: Zoning in unincorporated areas
   * - building: Building codes (unincorporated areas)
   * - drainage: Road/drainage construction
   * - septic: Septic systems
   * - flood: Flood plain development
   * - health: Health/safety regulations
   */
  categories: string[];
}

/**
 * CountyChunk - Processed chunk ready for embedding
 *
 * Compatible with ChunkMetadata from pinecone.ts for consistent
 * vector indexing across federal, state, and county sources.
 */
export interface CountyChunk {
  /** Unique chunk identifier (e.g., "county-harris-1.02-0") */
  chunkId: string;

  /** Source identifier (e.g., "county-harris") */
  sourceId: string;

  /** Source type discriminator */
  sourceType: 'county';

  /** Text content to embed */
  text: string;

  /** Bluebook citation (e.g., "Harris County, Tex., County Code sect. 1.02 (2026)") */
  citation: string;

  /** Direct URL to source */
  url: string;

  /** County name */
  county: string;

  /** FIPS code for county */
  fipsCode: string;

  /** Chapter number */
  chapter: string;

  /** Section number */
  section: string;

  /** Position of chunk within section (0-based) */
  chunkIndex: number;

  /** Total chunks for this section */
  totalChunks: number;

  /** Activity category tag (e.g., "subdivision", "zoning") */
  category?: string;
}

/**
 * CountyCheckpoint - Pipeline checkpoint for resumption
 *
 * Allows resuming pipeline from last successful state in case
 * of failures or rate limiting.
 */
export interface CountyCheckpoint {
  /** Source type being processed */
  sourceType: 'county';

  /** Last county successfully processed */
  lastProcessedCounty?: string;

  /** Last section successfully processed within current county */
  lastProcessedSection?: string;

  /** ISO 8601 timestamp of checkpoint */
  timestamp: string;

  /** Total chunks processed so far */
  chunksProcessed: number;

  /** Processing status */
  status: 'in_progress' | 'completed' | 'failed';

  /** Error message if status is 'failed' */
  error?: string;
}

/**
 * CountyAdapter - Abstract adapter interface for heterogeneous platforms
 *
 * Each county platform (Municode, eLaws, AmLegal, custom) requires
 * a different scraping strategy. This interface defines the contract
 * that platform-specific adapters must implement.
 */
export interface CountyAdapter {
  /** County name */
  county: string;

  /** FIPS code for county */
  fipsCode: string;

  /** Base URL for ordinance source */
  baseUrl: string;

  /** Platform type (affects scraping strategy) */
  platform: CountyPlatform;

  /**
   * Fetch all ordinances for this county
   *
   * Yields ordinances one at a time for memory efficiency
   * when processing large county codes.
   */
  fetchOrdinances(): AsyncGenerator<CountyOrdinance, void, unknown>;

  /**
   * Validate that source is accessible and hasn't changed structure
   *
   * Should check:
   * 1. URL returns 200
   * 2. Expected HTML structure exists
   * 3. No Cloudflare challenge blocking access
   */
  validateSource(): Promise<{ accessible: boolean; error?: string }>;
}
