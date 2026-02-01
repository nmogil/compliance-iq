/**
 * Texas State Data Pipeline Types
 *
 * TypeScript interfaces for Texas Statutes and Texas Administrative Code (TAC)
 * data structures, chunks, and pipeline configuration.
 */

/**
 * Texas Code - Top-level Texas Statutes grouping
 * Example: PE (Penal Code), HS (Health & Safety Code)
 */
export interface TexasCode {
  /** Code abbreviation (e.g., "PE", "HS", "OC") */
  abbreviation: string;
  /** Full code name (e.g., "Penal Code") */
  name: string;
  /** Chapters within the code */
  chapters: TexasChapter[];
}

/**
 * Texas Chapter - Chapter within a code
 * Example: Chapter 30 (Burglary and Criminal Trespass)
 */
export interface TexasChapter {
  /** Chapter number */
  number: string;
  /** Chapter name/subject */
  name: string;
  /** Sections within the chapter */
  sections: TexasStatuteSection[];
}

/**
 * Texas Statute Section - Individual statute section
 * Example: PE § 30.02 (Burglary)
 */
export interface TexasStatuteSection {
  /** Code abbreviation (e.g., "PE") */
  code: string;
  /** Chapter number */
  chapter: string;
  /** Section number (e.g., "30.02") */
  section: string;
  /** Section heading/title */
  heading: string;
  /** Full text content of the section */
  text: string;
  /** Subsections (if any) */
  subsections?: TexasSubsection[];
  /** Direct URL to capitol.texas.gov source */
  sourceUrl: string;
  /** ISO 8601 timestamp when scraped */
  scrapedAt: string;
}

/**
 * Texas Subsection - Subdivision within a section
 * Example: (a), (a)(1), (b)(2)(A)
 */
export interface TexasSubsection {
  /** Subsection identifier (e.g., "(a)", "(a)(1)") */
  id: string;
  /** Subsection text content */
  text: string;
}

/**
 * TAC Title - Texas Administrative Code title
 * Example: Title 16 (Economic Regulation)
 */
export interface TACTitle {
  /** Title number */
  number: number;
  /** Title name */
  name: string;
  /** Chapters within the title */
  chapters: TACChapter[];
}

/**
 * TAC Chapter - TAC chapter within a title
 * Example: Chapter 5 (Enforcement)
 */
export interface TACChapter {
  /** Chapter number */
  number: string;
  /** Chapter name/subject */
  name: string;
  /** Rules within the chapter */
  rules: TACRule[];
}

/**
 * TAC Rule - Individual TAC rule (equivalent to CFR section)
 * Example: 16 TAC § 5.31
 */
export interface TACRule {
  /** TAC title number */
  title: number;
  /** Chapter number */
  chapter: string;
  /** Section/rule number */
  section: string;
  /** Rule heading */
  heading: string;
  /** Full text content of the rule */
  text: string;
  /** Subsections (if any) */
  subsections?: TexasSubsection[];
  /** Direct URL to SOS source */
  sourceUrl: string;
  /** ISO 8601 timestamp when scraped */
  scrapedAt: string;
}

/**
 * Texas Chunk - Processed chunk ready for embedding (mirrors CFRChunk)
 * Compatible with ChunkMetadata from pinecone.ts
 */
export interface TexasChunk {
  /** Unique chunk identifier (e.g., "tx-statute-PE-30-30.02-0") */
  chunkId: string;

  /** Source identifier (e.g., "tx-statute-PE" or "tx-tac-16") */
  sourceId: string;

  /** Source type discriminator */
  sourceType: 'tx-statute' | 'tx-tac';

  /** Text content to embed */
  text: string;

  /** Bluebook citation (e.g., "Tex. Penal Code Ann. § 30.02 (West 2026)") */
  citation: string;

  /** Direct URL to source */
  url: string;

  /** Code abbreviation (for statutes only) */
  code?: string;

  /** TAC title number (for TAC only) */
  tacTitle?: number;

  /** Chapter number */
  chapter: string;

  /** Section number */
  section: string;

  /** Subsection identifier (optional, e.g., "(a)(1)") */
  subsection?: string;

  /** Hierarchy breadcrumbs for context */
  hierarchy: string[];

  /** Activity category tags (e.g., "alcohol", "food-safety") */
  category?: string;

  /** Position of chunk within section */
  chunkIndex: number;

  /** Total chunks for this section */
  totalChunks: number;
}

/**
 * Texas Checkpoint - Pipeline checkpoint for resumption
 * Allows resuming pipeline from last successful state
 */
export interface TexasCheckpoint {
  /** Source type being processed */
  sourceType: 'statute' | 'tac';

  /** Last code successfully processed (for statutes) */
  lastProcessedCode?: string;

  /** Last title successfully processed (for TAC) */
  lastProcessedTitle?: number;

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
 * Texas Code Configuration
 * Defines which codes to process and their category mappings
 */
export interface TexasCodeConfig {
  /** Code abbreviation */
  abbreviation: string;

  /** Full code name */
  name: string;

  /** Activity category tags for this code */
  categories: string[];

  /** Whether this code is enabled for processing */
  enabled: boolean;
}

/**
 * TAC Title Configuration
 * Defines which TAC titles to process and their category mappings
 */
export interface TACTitleConfig {
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
 * Target Texas Statutes for MVP
 * These 27 codes cover core retail compliance needs
 * Priority codes: OC, HS, AL, TX, LA, PE, BC, IN
 */
export const TARGET_STATUTES: TexasCodeConfig[] = [
  // Priority 1: Retail Operations Core
  {
    abbreviation: 'OC',
    name: 'Occupations Code',
    categories: ['licensing', 'professional-regulation'],
    enabled: true,
  },
  {
    abbreviation: 'HS',
    name: 'Health & Safety Code',
    categories: ['food-safety', 'pharmacy', 'hazmat'],
    enabled: true,
  },
  {
    abbreviation: 'AL',
    name: 'Alcoholic Beverage Code',
    categories: ['alcohol'],
    enabled: true,
  },
  {
    abbreviation: 'TX',
    name: 'Tax Code',
    categories: ['tax'],
    enabled: true,
  },
  {
    abbreviation: 'LA',
    name: 'Labor Code',
    categories: ['employment'],
    enabled: true,
  },
  {
    abbreviation: 'PE',
    name: 'Penal Code',
    categories: ['criminal', 'fraud'],
    enabled: true,
  },
  {
    abbreviation: 'BC',
    name: 'Business & Commerce Code',
    categories: ['consumer-protection', 'contracts'],
    enabled: true,
  },
  {
    abbreviation: 'IN',
    name: 'Insurance Code',
    categories: ['insurance'],
    enabled: true,
  },

  // Priority 2: Supporting Codes
  {
    abbreviation: 'AG',
    name: 'Agriculture Code',
    categories: ['food-safety', 'food-retail'],
    enabled: true,
  },
  {
    abbreviation: 'BO',
    name: 'Business Organizations Code',
    categories: ['corporate'],
    enabled: true,
  },
  {
    abbreviation: 'CP',
    name: 'Civil Practice & Remedies Code',
    categories: ['litigation'],
    enabled: true,
  },
  {
    abbreviation: 'CR',
    name: 'Criminal Procedure Code',
    categories: ['criminal'],
    enabled: true,
  },
  {
    abbreviation: 'ED',
    name: 'Education Code',
    categories: ['education'],
    enabled: true,
  },
  {
    abbreviation: 'EL',
    name: 'Election Code',
    categories: ['elections'],
    enabled: true,
  },
  {
    abbreviation: 'ES',
    name: 'Estates Code',
    categories: ['estates'],
    enabled: true,
  },
  {
    abbreviation: 'FA',
    name: 'Family Code',
    categories: ['family'],
    enabled: true,
  },
  {
    abbreviation: 'FI',
    name: 'Finance Code',
    categories: ['banking', 'finance'],
    enabled: true,
  },
  {
    abbreviation: 'GV',
    name: 'Government Code',
    categories: ['government'],
    enabled: true,
  },
  {
    abbreviation: 'HR',
    name: 'Human Resources Code',
    categories: ['social-services'],
    enabled: true,
  },
  {
    abbreviation: 'LG',
    name: 'Local Government Code',
    categories: ['local-government'],
    enabled: true,
  },
  {
    abbreviation: 'NR',
    name: 'Natural Resources Code',
    categories: ['natural-resources'],
    enabled: true,
  },
  {
    abbreviation: 'PW',
    name: 'Parks & Wildlife Code',
    categories: ['parks'],
    enabled: true,
  },
  {
    abbreviation: 'PR',
    name: 'Property Code',
    categories: ['property', 'real-estate'],
    enabled: true,
  },
  {
    abbreviation: 'SD',
    name: 'Special District Local Laws Code',
    categories: ['special-districts'],
    enabled: true,
  },
  {
    abbreviation: 'TN',
    name: 'Transportation Code',
    categories: ['transportation'],
    enabled: true,
  },
  {
    abbreviation: 'UT',
    name: 'Utilities Code',
    categories: ['utilities'],
    enabled: true,
  },
  {
    abbreviation: 'WA',
    name: 'Water Code',
    categories: ['water'],
    enabled: true,
  },
];

/**
 * Target TAC Titles for MVP
 * These 5 titles cover core regulatory compliance needs
 */
export const TARGET_TAC_TITLES: TACTitleConfig[] = [
  {
    number: 16,
    name: 'Economic Regulation',
    categories: ['alcohol', 'licensing'],
    enabled: true,
  },
  {
    number: 22,
    name: 'Health Services',
    categories: ['pharmacy', 'food-safety'],
    enabled: true,
  },
  {
    number: 25,
    name: 'Environmental Quality',
    categories: ['environmental', 'hazmat'],
    enabled: true,
  },
  {
    number: 30,
    name: 'Environmental Quality',
    categories: ['environmental', 'water'],
    enabled: true,
  },
  {
    number: 37,
    name: 'Public Safety and Corrections',
    categories: ['licensing', 'professional-regulation'],
    enabled: true,
  },
];

/**
 * Get enabled statute codes
 * @returns Array of enabled Texas code configurations
 */
export function getEnabledStatuteCodes(): TexasCodeConfig[] {
  return TARGET_STATUTES.filter(code => code.enabled);
}

/**
 * Get enabled TAC titles
 * @returns Array of enabled TAC title configurations
 */
export function getEnabledTACTitles(): TACTitleConfig[] {
  return TARGET_TAC_TITLES.filter(title => title.enabled);
}

/**
 * Get categories for a statute code
 * @param abbreviation Code abbreviation (e.g., "PE", "HS")
 * @returns Array of category tags, or empty array if code not found
 */
export function getCategoriesForCode(abbreviation: string): string[] {
  const config = TARGET_STATUTES.find(c => c.abbreviation === abbreviation);
  return config?.categories ?? [];
}

/**
 * Get categories for a TAC title
 * @param titleNumber TAC title number
 * @returns Array of category tags, or empty array if title not found
 */
export function getCategoriesForTACTitle(titleNumber: number): string[] {
  const config = TARGET_TAC_TITLES.find(t => t.number === titleNumber);
  return config?.categories ?? [];
}
