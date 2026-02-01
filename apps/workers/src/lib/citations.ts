/**
 * Bluebook Citation Utilities
 *
 * Generates standard legal citations and URLs for CFR references
 * following The Bluebook citation format.
 */

/**
 * Generate Bluebook-format CFR citation
 *
 * Format: [Title] C.F.R. § [Section][(Subsection)]
 *
 * @param title CFR title number (1-50)
 * @param section Section number (e.g., "117.3")
 * @param subsection Optional subsection identifier (e.g., "(a)(1)")
 * @returns Bluebook citation string
 *
 * @example
 * ```ts
 * generateCFRCitation(21, '117.3')
 * // => "21 C.F.R. § 117.3"
 *
 * generateCFRCitation(21, '117.3', '(a)(1)')
 * // => "21 C.F.R. § 117.3(a)(1)"
 * ```
 */
export function generateCFRCitation(
  title: number,
  section: string,
  subsection?: string
): string {
  // Validate section format (should be numeric.numeric)
  if (!/^\d+\.\d+$/.test(section)) {
    throw new Error(`Invalid section format: ${section}. Expected format: "123.456"`);
  }

  // Build base citation
  let citation = `${title} C.F.R. § ${section}`;

  // Add subsection if provided
  if (subsection) {
    citation += subsection;
  }

  return citation;
}

/**
 * Generate eCFR.gov URL for a specific section
 *
 * @param title CFR title number
 * @param part Part number
 * @param section Section number (e.g., "117.3")
 * @returns Direct URL to eCFR.gov
 *
 * @example
 * ```ts
 * generateECFRUrl(21, 117, '117.3')
 * // => "https://www.ecfr.gov/current/title-21/part-117/section-117.3"
 * ```
 */
export function generateECFRUrl(
  title: number,
  part: number,
  section: string
): string {
  return `https://www.ecfr.gov/current/title-${title}/part-${part}/section-${section}`;
}

/**
 * Generate hierarchy breadcrumbs for RAG context
 *
 * Creates a breadcrumb array showing the full regulatory path,
 * useful for providing context in vector search results.
 *
 * @param title CFR title number
 * @param chapter Chapter identifier (e.g., "I", "A")
 * @param part Part number
 * @param section Section number
 * @returns Array of hierarchy strings
 *
 * @example
 * ```ts
 * generateHierarchy(21, 'I', 117, '117.3')
 * // => ["Title 21", "Chapter I", "Part 117", "Section 117.3"]
 * ```
 */
export function generateHierarchy(
  title: number,
  chapter: string,
  part: number,
  section: string
): string[] {
  return [
    `Title ${title}`,
    `Chapter ${chapter}`,
    `Part ${part}`,
    `Section ${section}`,
  ];
}

/**
 * Parse section string into part and section components
 *
 * CFR sections follow the format "Part.Section" (e.g., "117.3").
 * This extracts the part number from the section string.
 *
 * @param sectionString Section number (e.g., "117.3", "1.1", "999.999")
 * @returns Object with part number and section string
 *
 * @example
 * ```ts
 * parseSection('117.3')
 * // => { part: 117, section: '117.3' }
 *
 * parseSection('1.1')
 * // => { part: 1, section: '1.1' }
 * ```
 */
export function parseSection(sectionString: string): {
  part: number;
  section: string;
} {
  // Validate format
  if (!/^\d+\.\d+$/.test(sectionString)) {
    throw new Error(
      `Invalid section format: ${sectionString}. Expected format: "123.456"`
    );
  }

  // Extract part number (everything before the decimal)
  const dotIndex = sectionString.indexOf('.');
  const partString = sectionString.substring(0, dotIndex);
  const part = parseInt(partString, 10);

  if (isNaN(part)) {
    throw new Error(`Failed to parse part number from section: ${sectionString}`);
  }

  return {
    part,
    section: sectionString,
  };
}

/**
 * Generate a unique chunk ID for a CFR section chunk
 *
 * Format: cfr-{title}-{part}-{section}-{chunkIndex}
 *
 * @param title CFR title number
 * @param part Part number
 * @param section Section number
 * @param chunkIndex Index of chunk within section (0-based)
 * @returns Unique chunk identifier
 *
 * @example
 * ```ts
 * generateChunkId(21, 117, '117.3', 0)
 * // => "cfr-21-117-117.3-0"
 * ```
 */
export function generateChunkId(
  title: number,
  part: number,
  section: string,
  chunkIndex: number
): string {
  return `cfr-${title}-${part}-${section}-${chunkIndex}`;
}

/**
 * Generate source ID for a CFR title
 *
 * Format: cfr-title-{number}
 *
 * @param titleNumber CFR title number
 * @returns Source identifier
 *
 * @example
 * ```ts
 * generateSourceId(21)
 * // => "cfr-title-21"
 * ```
 */
export function generateSourceId(titleNumber: number): string {
  return `cfr-title-${titleNumber}`;
}

// ============================================================================
// Texas Citation Utilities
// ============================================================================

/**
 * Texas Code abbreviation to Bluebook format mapping
 * Based on The Bluebook (21st ed.) Table 1.3
 */
const TEXAS_CODE_ABBREVIATIONS: Record<string, string> = {
  'AG': 'Agric. Code',
  'AL': 'Alco. Bev. Code',
  'BC': 'Bus. & Com. Code',
  'BO': 'Bus. Orgs. Code',
  'CP': 'Civ. Prac. & Rem. Code',
  'CR': 'Crim. Proc. Code',
  'ED': 'Educ. Code',
  'EL': 'Elec. Code',
  'ES': 'Estates Code',
  'FA': 'Fam. Code',
  'FI': 'Fin. Code',
  'GV': 'Gov\'t Code',
  'HS': 'Health & Safety Code',
  'HR': 'Hum. Res. Code',
  'IN': 'Ins. Code',
  'LA': 'Lab. Code',
  'LG': 'Loc. Gov\'t Code',
  'NR': 'Nat. Res. Code',
  'OC': 'Occ. Code',
  'PW': 'Parks & Wild. Code',
  'PE': 'Penal Code',
  'PR': 'Prop. Code',
  'SD': 'Spec. Dist. Local Laws Code',
  'TX': 'Tax Code',
  'TN': 'Transp. Code',
  'UT': 'Util. Code',
  'WA': 'Water Code',
};

/**
 * Generate Bluebook-format Texas statute citation
 *
 * Format: Tex. [Code Name] Ann. § [section] (West [year])
 *
 * @param code Code abbreviation (e.g., "PE", "HS", "AL")
 * @param section Section number (e.g., "30.02", "481.002")
 * @param year Publication year (defaults to current year)
 * @returns Bluebook citation string
 *
 * @example
 * ```ts
 * generateTexasStatuteCitation('PE', '30.02', 2026)
 * // => "Tex. Penal Code Ann. § 30.02 (West 2026)"
 *
 * generateTexasStatuteCitation('HS', '481.002')
 * // => "Tex. Health & Safety Code Ann. § 481.002 (West 2026)"
 * ```
 */
export function generateTexasStatuteCitation(
  code: string,
  section: string,
  year?: number
): string {
  const codeName = TEXAS_CODE_ABBREVIATIONS[code];
  if (!codeName) {
    throw new Error(`Unknown Texas code abbreviation: ${code}`);
  }

  const citationYear = year ?? new Date().getFullYear();
  return `Tex. ${codeName} Ann. § ${section} (West ${citationYear})`;
}

/**
 * Generate Bluebook-format Texas Administrative Code citation
 *
 * Format: [Title] Tex. Admin. Code § [section] ([year])
 *
 * @param title TAC title number (e.g., 16, 22, 25)
 * @param section Section number (e.g., "5.31", "289.1")
 * @param year Publication year (defaults to current year)
 * @returns Bluebook citation string
 *
 * @example
 * ```ts
 * generateTACCitation(16, '5.31', 2026)
 * // => "16 Tex. Admin. Code § 5.31 (2026)"
 *
 * generateTACCitation(22, '289.1')
 * // => "22 Tex. Admin. Code § 289.1 (2026)"
 * ```
 */
export function generateTACCitation(
  title: number,
  section: string,
  year?: number
): string {
  const citationYear = year ?? new Date().getFullYear();
  return `${title} Tex. Admin. Code § ${section} (${citationYear})`;
}

/**
 * Generate URL for Texas statute on capitol.texas.gov
 *
 * Format: https://statutes.capitol.texas.gov/Docs/[CODE]/htm/[CODE].[section].htm
 *
 * @param code Code abbreviation (e.g., "PE", "HS")
 * @param section Section number (e.g., "30.02")
 * @returns Direct URL to statute
 *
 * @example
 * ```ts
 * generateStatuteUrl('PE', '30.02')
 * // => "https://statutes.capitol.texas.gov/Docs/PE/htm/PE.30.02.htm"
 * ```
 */
export function generateStatuteUrl(code: string, section: string): string {
  return `https://statutes.capitol.texas.gov/Docs/${code}/htm/${code}.${section}.htm`;
}

/**
 * Generate URL for TAC rule on sos.state.tx.us
 *
 * Format: https://texreg.sos.state.tx.us/public/readtac$ext.TacPage?sl=R&app=9&p_dir=&p_rloc={title}&p_tloc=&p_ploc=&pg=1&p_tac=&ti={title}&pt=&ch={chapter}&rl={section}
 *
 * @param title TAC title number
 * @param chapter Chapter number
 * @param section Section number
 * @returns Direct URL to TAC rule
 *
 * @example
 * ```ts
 * generateTACUrl(16, '5', '5.31')
 * // => "https://texreg.sos.state.tx.us/public/readtac$ext.TacPage?sl=R&app=9&p_dir=&p_rloc=16&p_tloc=&p_ploc=&pg=1&p_tac=&ti=16&pt=&ch=5&rl=5.31"
 * ```
 */
export function generateTACUrl(
  title: number,
  chapter: string,
  section: string
): string {
  return `https://texreg.sos.state.tx.us/public/readtac$ext.TacPage?sl=R&app=9&p_dir=&p_rloc=${title}&p_tloc=&p_ploc=&pg=1&p_tac=&ti=${title}&pt=&ch=${chapter}&rl=${section}`;
}

/**
 * Generate a unique chunk ID for a Texas statute or TAC chunk
 *
 * Format: tx-{sourceType}-{code|title}-{chapter}-{section}-{chunkIndex}
 *
 * @param sourceType 'statute' or 'tac'
 * @param code Code abbreviation (for statutes) or title number (for TAC)
 * @param chapter Chapter number
 * @param section Section number
 * @param chunkIndex Index of chunk within section (0-based)
 * @returns Unique chunk identifier
 *
 * @example
 * ```ts
 * generateTexasChunkId('statute', 'PE', '30', '30.02', 0)
 * // => "tx-statute-PE-30-30.02-0"
 *
 * generateTexasChunkId('tac', '16', '5', '5.31', 0)
 * // => "tx-tac-16-5-5.31-0"
 * ```
 */
export function generateTexasChunkId(
  sourceType: 'statute' | 'tac',
  code: string | number,
  chapter: string,
  section: string,
  chunkIndex: number
): string {
  return `tx-${sourceType}-${code}-${chapter}-${section}-${chunkIndex}`;
}

/**
 * Generate source ID for a Texas statute code or TAC title
 *
 * Format: tx-{sourceType}-{code|title}
 *
 * @param sourceType 'statute' or 'tac'
 * @param code Code abbreviation (for statutes) or title number (for TAC)
 * @returns Source identifier
 *
 * @example
 * ```ts
 * generateTexasSourceId('statute', 'PE')
 * // => "tx-statute-PE"
 *
 * generateTexasSourceId('tac', 16)
 * // => "tx-tac-16"
 * ```
 */
export function generateTexasSourceId(
  sourceType: 'statute' | 'tac',
  code: string | number
): string {
  return `tx-${sourceType}-${code}`;
}

/**
 * Generate hierarchy breadcrumbs for Texas statutes and TAC
 *
 * Creates a breadcrumb array showing the full regulatory path,
 * useful for providing context in vector search results.
 *
 * @param sourceType 'statute' or 'tac'
 * @param codeName Full code name or TAC title name
 * @param chapter Chapter number or identifier
 * @param section Section number
 * @returns Array of hierarchy strings
 *
 * @example
 * ```ts
 * generateTexasHierarchy('statute', 'Penal Code', '30', '30.02')
 * // => ["Texas Statutes", "Penal Code", "Chapter 30", "Section 30.02"]
 *
 * generateTexasHierarchy('tac', 'Economic Regulation', '5', '5.31')
 * // => ["Texas Admin Code", "Title 16: Economic Regulation", "Chapter 5", "Section 5.31"]
 * ```
 */
export function generateTexasHierarchy(
  sourceType: 'statute' | 'tac',
  codeName: string,
  chapter: string,
  section: string
): string[] {
  if (sourceType === 'statute') {
    return [
      'Texas Statutes',
      codeName,
      `Chapter ${chapter}`,
      `Section ${section}`,
    ];
  } else {
    return [
      'Texas Admin Code',
      codeName,
      `Chapter ${chapter}`,
      `Section ${section}`,
    ];
  }
}
