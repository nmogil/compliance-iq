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

// ============================================================================
// County Citation Utilities
// ============================================================================

import { format } from 'date-fns';

import type { CountySourceConfig } from '../counties/types';

/**
 * Generate Bluebook-format county ordinance citation
 *
 * Based on Bluebook Rule 12.9.2: Municipal ordinances cited analogously to statutes.
 * Format: [County Name] County, Tex., [Code Name] sect. [section] ([year])
 *
 * @param county County name (e.g., "Harris", "Dallas")
 * @param codeName Code name (e.g., "County Code", "Code of Ordinances")
 * @param section Section number (e.g., "1.02", "2.03.040")
 * @param year Publication year (defaults to current year)
 * @returns Bluebook citation string
 *
 * @example
 * ```ts
 * generateCountyCitation('Harris', 'County Code', '1.02', 2026)
 * // => "Harris County, Tex., County Code sect. 1.02 (2026)"
 *
 * generateCountyCitation('Dallas', 'Code of Ordinances', '2.03.040')
 * // => "Dallas County, Tex., Code of Ordinances sect. 2.03.040 (2026)"
 * ```
 */
export function generateCountyCitation(
  county: string,
  codeName: string,
  section: string,
  year?: number
): string {
  const citationYear = year ?? new Date().getFullYear();
  return `${county} County, Tex., ${codeName} sect. ${section} (${citationYear})`;
}

/**
 * Generate Bluebook-format commissioners court order citation
 *
 * Format: [County Name] County Commissioners Court Order No. [number] ([date])
 *
 * @param county County name (e.g., "Tarrant", "Harris")
 * @param orderNumber Order number/identifier (e.g., "2026-045", "O-23-1234")
 * @param adoptionDate Date the order was adopted
 * @returns Bluebook citation string
 *
 * @example
 * ```ts
 * generateCourtOrderCitation('Tarrant', '2026-045', new Date('2026-03-15'))
 * // => "Tarrant County Commissioners Court Order No. 2026-045 (Mar. 15, 2026)"
 *
 * generateCourtOrderCitation('Harris', 'O-24-0567', new Date('2024-11-05'))
 * // => "Harris County Commissioners Court Order No. O-24-0567 (Nov. 5, 2024)"
 * ```
 */
export function generateCourtOrderCitation(
  county: string,
  orderNumber: string,
  adoptionDate: Date
): string {
  // Format date as "MMM. d, yyyy" (e.g., "Mar. 15, 2026")
  const dateStr = format(adoptionDate, 'MMM. d, yyyy');
  return `${county} County Commissioners Court Order No. ${orderNumber} (${dateStr})`;
}

/**
 * Generate URL for county ordinance based on platform
 *
 * Handles platform-specific URL patterns for Municode, eLaws, and American Legal.
 *
 * @param config County source configuration
 * @param section Optional section number for deep linking
 * @returns URL to county ordinance (base URL or section-specific)
 * @throws Error if county has no online source configured
 *
 * @example
 * ```ts
 * const harrisConfig = { platform: 'municode', baseUrl: 'https://library.municode.com/tx/harris_county/codes/code_of_ordinances' };
 *
 * generateCountyOrdinanceUrl(harrisConfig)
 * // => "https://library.municode.com/tx/harris_county/codes/code_of_ordinances"
 *
 * generateCountyOrdinanceUrl(harrisConfig, '1.02')
 * // => "https://library.municode.com/tx/harris_county/codes/code_of_ordinances?nodeId=1.02"
 *
 * const dallasConfig = { platform: 'elaws', baseUrl: 'http://dallascounty-tx.elaws.us/code/coor' };
 *
 * generateCountyOrdinanceUrl(dallasConfig, '2.03.040')
 * // => "http://dallascounty-tx.elaws.us/code/coor#2.03.040"
 * ```
 */
export function generateCountyOrdinanceUrl(
  config: Pick<CountySourceConfig, 'name' | 'platform' | 'baseUrl'>,
  section?: string
): string {
  if (!config.baseUrl) {
    throw new Error(`County ${config.name} has no online source configured`);
  }

  // Return base URL if no section specified
  if (!section) {
    return config.baseUrl;
  }

  // Platform-specific URL construction
  switch (config.platform) {
    case 'municode':
      // Municode uses nodeId parameter for sections
      return `${config.baseUrl}?nodeId=${encodeURIComponent(section)}`;

    case 'elaws':
      // eLaws uses hash fragment for sections
      return `${config.baseUrl}#${encodeURIComponent(section)}`;

    case 'amlegal':
      // American Legal uses nodeId in path
      return `${config.baseUrl}/codes/overview?nodeId=${encodeURIComponent(section)}`;

    case 'custom':
    case 'court-orders':
    default:
      // For custom or court orders, just return base URL with section as hash
      return `${config.baseUrl}#${encodeURIComponent(section)}`;
  }
}

/**
 * Generate a unique chunk ID for a county ordinance chunk
 *
 * Format: county-{county}-{chapter}-{section}-{chunkIndex}
 *
 * @param county County name (lowercase, hyphenated for spaces)
 * @param chapter Chapter number
 * @param section Section number
 * @param chunkIndex Index of chunk within section (0-based)
 * @returns Unique chunk identifier
 *
 * @example
 * ```ts
 * generateCountyChunkId('Harris', '1', '1.02', 0)
 * // => "county-harris-1-1.02-0"
 *
 * generateCountyChunkId('Fort Bend', '2', '2.03.040', 1)
 * // => "county-fort-bend-2-2.03.040-1"
 * ```
 */
export function generateCountyChunkId(
  county: string,
  chapter: string,
  section: string,
  chunkIndex: number
): string {
  const normalizedCounty = county.toLowerCase().replace(/\s+/g, '-');
  return `county-${normalizedCounty}-${chapter}-${section}-${chunkIndex}`;
}

/**
 * Generate source ID for a county
 *
 * Format: county-{county}
 *
 * @param county County name (lowercase, hyphenated for spaces)
 * @returns Source identifier
 *
 * @example
 * ```ts
 * generateCountySourceId('Harris')
 * // => "county-harris"
 *
 * generateCountySourceId('Fort Bend')
 * // => "county-fort-bend"
 * ```
 */
export function generateCountySourceId(county: string): string {
  const normalizedCounty = county.toLowerCase().replace(/\s+/g, '-');
  return `county-${normalizedCounty}`;
}

/**
 * Generate hierarchy breadcrumbs for county ordinances
 *
 * Creates a breadcrumb array showing the full regulatory path,
 * useful for providing context in vector search results.
 *
 * @param county County name
 * @param chapter Chapter number or identifier
 * @param section Section number
 * @returns Array of hierarchy strings
 *
 * @example
 * ```ts
 * generateCountyHierarchy('Harris', '1', '1.02')
 * // => ["Texas Counties", "Harris County", "Chapter 1", "Section 1.02"]
 *
 * generateCountyHierarchy('Fort Bend', '2', '2.03.040')
 * // => ["Texas Counties", "Fort Bend County", "Chapter 2", "Section 2.03.040"]
 * ```
 */
export function generateCountyHierarchy(
  county: string,
  chapter: string,
  section: string
): string[] {
  return [
    'Texas Counties',
    `${county} County`,
    `Chapter ${chapter}`,
    `Section ${section}`,
  ];
}

// ============================================================================
// Municipal Citation Utilities
// ============================================================================

import type { MunicipalCityConfig } from '../municipal/types';

/**
 * Generate Bluebook-format municipal ordinance citation
 *
 * Based on Bluebook Rule 12.9.2: Municipal ordinances cited analogously to statutes.
 * Format: [City], Tex., Code of Ordinances sect. [section] ([year])
 *
 * @param city City name (e.g., "Houston", "Dallas")
 * @param section Section number (e.g., "1-2", "10.4.5")
 * @param year Publication year (defaults to current year)
 * @returns Bluebook citation string
 *
 * @example
 * ```ts
 * generateMunicipalCitation('Houston', '1-2', 2026)
 * // => "Houston, Tex., Code of Ordinances sect. 1-2 (2026)"
 *
 * generateMunicipalCitation('Dallas', '10.4.5')
 * // => "Dallas, Tex., Code of Ordinances sect. 10.4.5 (2026)"
 * ```
 */
export function generateMunicipalCitation(
  city: string,
  section: string,
  year?: number
): string {
  const citationYear = year ?? new Date().getFullYear();
  return `${city}, Tex., Code of Ordinances sect. ${section} (${citationYear})`;
}

/**
 * Generate a unique chunk ID for a municipal ordinance chunk
 *
 * Format: municipal-{cityId}-{chapter}-{section}-{chunkIndex}
 *
 * @param cityId City identifier (URL-safe, e.g., "houston", "san_antonio")
 * @param chapter Chapter number
 * @param section Section number
 * @param chunkIndex Index of chunk within section (0-based)
 * @returns Unique chunk identifier
 *
 * @example
 * ```ts
 * generateMunicipalChunkId('houston', '1', '1-2', 0)
 * // => "municipal-houston-1-1-2-0"
 *
 * generateMunicipalChunkId('san_antonio', '10', '10.4.5', 1)
 * // => "municipal-san_antonio-10-10.4.5-1"
 * ```
 */
export function generateMunicipalChunkId(
  cityId: string,
  chapter: string,
  section: string,
  chunkIndex: number
): string {
  return `municipal-${cityId}-${chapter}-${section}-${chunkIndex}`;
}

/**
 * Generate source ID for a municipal city
 *
 * Format: municipal-{cityId}
 *
 * @param cityId City identifier (URL-safe, e.g., "houston")
 * @returns Source identifier
 *
 * @example
 * ```ts
 * generateMunicipalSourceId('houston')
 * // => "municipal-houston"
 *
 * generateMunicipalSourceId('san_antonio')
 * // => "municipal-san_antonio"
 * ```
 */
export function generateMunicipalSourceId(cityId: string): string {
  return `municipal-${cityId}`;
}

/**
 * Generate URL for municipal ordinance based on platform
 *
 * Handles platform-specific URL patterns for Municode and American Legal.
 *
 * @param config Municipal city configuration
 * @param section Optional section number for deep linking
 * @returns URL to municipal ordinance (base URL or section-specific)
 *
 * @example
 * ```ts
 * const houstonConfig = { platform: 'municode', baseUrl: 'https://library.municode.com/tx/houston/codes/code_of_ordinances' };
 *
 * generateMunicipalUrl(houstonConfig)
 * // => "https://library.municode.com/tx/houston/codes/code_of_ordinances"
 *
 * generateMunicipalUrl(houstonConfig, '1-2')
 * // => "https://library.municode.com/tx/houston/codes/code_of_ordinances?nodeId=1-2"
 *
 * const dallasConfig = { platform: 'amlegal', baseUrl: 'https://codelibrary.amlegal.com/codes/dallas/latest/dallas_tx/0-0-0-1' };
 *
 * generateMunicipalUrl(dallasConfig, '10.4.5')
 * // => "https://codelibrary.amlegal.com/codes/dallas/latest/dallas_tx/0-0-0-1#10.4.5"
 * ```
 */
export function generateMunicipalUrl(
  config: Pick<MunicipalCityConfig, 'platform' | 'baseUrl'>,
  section?: string
): string {
  // Return base URL if no section specified
  if (!section) {
    return config.baseUrl;
  }

  // Platform-specific URL construction
  switch (config.platform) {
    case 'municode':
      // Municode uses nodeId parameter for sections
      return `${config.baseUrl}?nodeId=${encodeURIComponent(section)}`;

    case 'amlegal':
      // American Legal uses hash fragment for sections
      return `${config.baseUrl}#${encodeURIComponent(section)}`;

    default:
      // Fallback to hash
      return `${config.baseUrl}#${encodeURIComponent(section)}`;
  }
}

/**
 * Generate hierarchy breadcrumbs for municipal ordinances
 *
 * Creates a breadcrumb array showing the full regulatory path,
 * useful for providing context in vector search results.
 *
 * @param cityName City display name (e.g., "Houston", "San Antonio")
 * @param chapter Chapter number or identifier
 * @param section Section number
 * @returns Array of hierarchy strings
 *
 * @example
 * ```ts
 * generateMunicipalHierarchy('Houston', '1', '1-2')
 * // => ["Texas Municipalities", "Houston", "Chapter 1", "Section 1-2"]
 *
 * generateMunicipalHierarchy('San Antonio', '10', '10.4.5')
 * // => ["Texas Municipalities", "San Antonio", "Chapter 10", "Section 10.4.5"]
 * ```
 */
export function generateMunicipalHierarchy(
  cityName: string,
  chapter: string,
  section: string
): string[] {
  return [
    'Texas Municipalities',
    cityName,
    `Chapter ${chapter}`,
    `Section ${section}`,
  ];
}
