/**
 * Federal Data Pipeline Types
 *
 * TypeScript interfaces for CFR (Code of Federal Regulations) data structures,
 * chunks, and pipeline configuration.
 */

/**
 * CFR Title - Top-level regulatory grouping
 * Example: Title 21 (Food and Drugs)
 */
export interface CFRTitle {
  /** Title number (1-50) */
  number: number;
  /** Full title name */
  name: string;
  /** Chapters within the title */
  chapters: CFRChapter[];
}

/**
 * CFR Chapter - Subdivision of a title
 * Example: Chapter I (Food and Drug Administration)
 */
export interface CFRChapter {
  /** Chapter identifier (Roman numerals or letters) */
  number: string;
  /** Chapter name/subject */
  name: string;
  /** Parts within the chapter */
  parts: CFRPart[];
}

/**
 * CFR Part - Major regulatory subdivision
 * Example: Part 117 (Current Good Manufacturing Practice)
 */
export interface CFRPart {
  /** Part number */
  number: number;
  /** Part title */
  name: string;
  /** Sections within the part */
  sections: CFRSection[];
}

/**
 * CFR Section - Individual regulatory provision
 * Example: Section 117.3 (Definitions)
 */
export interface CFRSection {
  /** Section number (e.g., "117.3") */
  number: string;
  /** Section title/heading */
  title: string;
  /** Full text content of the section */
  text: string;
  /** Subsections (if any) */
  subsections?: CFRSubsection[];
  /** Date this section became effective */
  effectiveDate?: string;
  /** Date this section was last amended */
  lastAmended?: string;
}

/**
 * CFR Subsection - Subdivision within a section
 * Example: 117.3(a)(1)
 */
export interface CFRSubsection {
  /** Subsection identifier (e.g., "(a)", "(a)(1)") */
  id: string;
  /** Subsection text content */
  text: string;
}

/**
 * CFR Chunk - Processed chunk ready for embedding
 * Compatible with ChunkMetadata from pinecone.ts
 */
export interface CFRChunk {
  /** Unique chunk identifier (e.g., "cfr-21-117-117.3-0") */
  chunkId: string;

  /** Source identifier (e.g., "cfr-title-21") */
  sourceId: string;

  /** Text content to embed */
  text: string;

  /** Bluebook citation (e.g., "21 C.F.R. § 117.3") */
  citation: string;

  /** Direct URL to eCFR.gov source */
  url: string;

  /** CFR title number */
  title: number;

  /** CFR part number */
  part: number;

  /** Section number (e.g., "117.3") */
  section: string;

  /** Subsection identifier (optional, e.g., "(a)(1)") */
  subsection?: string;

  /** Hierarchy breadcrumbs for context */
  hierarchy: string[];

  /** Activity category tags (e.g., "food-safety", "pharmacy") */
  category?: string;

  /** Date this section became effective */
  effectiveDate?: string;

  /** Date this section was last amended */
  lastAmended?: string;

  /** Position of chunk within section */
  chunkIndex: number;

  /** Total chunks for this section */
  totalChunks: number;
}

/**
 * Pipeline Checkpoint - For R2 checkpointing during processing
 * Allows resuming pipeline from last successful state
 */
export interface PipelineCheckpoint {
  /** Title number being processed */
  titleNumber: number;

  /** Last part successfully processed within the title */
  lastProcessedPart: number;

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
 * CFR Title Configuration
 * Defines which titles to process and their category mappings
 */
export interface CFRTitleConfig {
  /** Title number */
  number: number;

  /** Title name */
  name: string;

  /** Activity category tags for this title */
  categories: string[];

  /** Whether this title is enabled for processing */
  enabled: boolean;
}

/**
 * Target CFR Titles for MVP
 * These 7 titles cover the core compliance needs for retail operations
 */
export const TARGET_TITLES: CFRTitleConfig[] = [
  {
    number: 7,
    name: 'Agriculture',
    categories: ['food-retail', 'food-safety'],
    enabled: true,
  },
  {
    number: 9,
    name: 'Animals and Animal Products',
    categories: ['food-safety'],
    enabled: true,
  },
  {
    number: 21,
    name: 'Food and Drugs',
    categories: ['food-safety', 'pharmacy'],
    enabled: true,
  },
  {
    number: 27,
    name: 'Alcohol, Tobacco, Products and Firearms',
    categories: ['alcohol'],
    enabled: true,
  },
  {
    number: 29,
    name: 'Labor',
    categories: ['employment'],
    enabled: true,
  },
  {
    number: 40,
    name: 'Protection of Environment',
    categories: ['fuel', 'hazmat'],
    enabled: true,
  },
  {
    number: 49,
    name: 'Transportation',
    categories: ['fuel', 'transportation'],
    enabled: true,
  },
];

/**
 * Get enabled target titles
 * @returns Array of enabled CFR title configurations
 */
export function getEnabledTitles(): CFRTitleConfig[] {
  return TARGET_TITLES.filter(title => title.enabled);
}

/**
 * Get categories for a title number
 * @param titleNumber CFR title number
 * @returns Array of category tags, or empty array if title not found
 */
export function getCategoriesForTitle(titleNumber: number): string[] {
  const config = TARGET_TITLES.find(t => t.number === titleNumber);
  return config?.categories ?? [];
}
