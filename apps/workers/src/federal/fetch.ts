/**
 * eCFR API integration for fetching federal regulations
 *
 * API documentation: https://www.ecfr.gov/developers/documentation/api/versioner/v1
 */

import { XMLParser } from 'fast-xml-parser';

/**
 * Custom error class for eCFR API fetch failures
 */
export class ECFRFetchError extends Error {
  constructor(
    public status: number,
    public title: string | number,
    message: string
  ) {
    super(message);
    this.name = 'ECFRFetchError';
  }
}

/**
 * Retry configuration for eCFR API calls
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  delays: [1000, 2000, 4000], // 1s, 2s, 4s exponential backoff
};

/**
 * Base URL for eCFR API
 */
const ECFR_BASE_URL = 'https://www.ecfr.gov/api/versioner/v1';

/**
 * Cached date from eCFR API metadata
 */
let cachedAvailableDate: string | null = null;

/**
 * Get the most recent available date from eCFR API
 * The eCFR API often lags behind the current date, so we need to
 * fetch the actual available date from the API metadata.
 */
async function getAvailableDateFromAPI(): Promise<string> {
  if (cachedAvailableDate) {
    return cachedAvailableDate;
  }

  try {
    const response = await fetch(`${ECFR_BASE_URL}/titles`);
    if (response.ok) {
      const data = await response.json() as { meta?: { date?: string } };
      if (data.meta?.date) {
        cachedAvailableDate = data.meta.date;
        console.log(`[eCFR] Using API available date: ${cachedAvailableDate}`);
        return cachedAvailableDate;
      }
    }
  } catch (error) {
    console.warn('[eCFR] Failed to fetch available date, using fallback');
  }

  // Fallback: use yesterday's date (API usually has at least that)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 7); // Use a week ago to be safe
  cachedAvailableDate = yesterday.toISOString().split('T')[0] as string;
  console.log(`[eCFR] Using fallback date: ${cachedAvailableDate}`);
  return cachedAvailableDate;
}

/**
 * Get current date in YYYY-MM-DD format for eCFR API
 * @deprecated Use getAvailableDateFromAPI() instead for reliability
 */
function getCurrentDateString(): string {
  const datePart = new Date().toISOString().split('T')[0];
  if (!datePart) {
    throw new Error('Failed to format current date');
  }
  return datePart;
}

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error = new Error(`Failed after ${RETRY_CONFIG.maxRetries} retries`);

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      console.log(`[eCFR] Attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1} for ${operationName}`);
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on 404 (title not found)
      if (error instanceof ECFRFetchError && error.status === 404) {
        throw error;
      }

      // If this was the last attempt, throw
      if (attempt === RETRY_CONFIG.maxRetries) {
        throw lastError;
      }

      // Wait before retry
      const delay = RETRY_CONFIG.delays[attempt];
      console.log(`[eCFR] Retrying ${operationName} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Fetch the structure (parts list) of a CFR title from eCFR API
 *
 * @param titleNumber - CFR title number
 * @returns Array of part numbers that exist in this title
 */
export async function fetchCFRTitleStructure(titleNumber: number): Promise<{ parts: number[] }> {
  const date = await getAvailableDateFromAPI();
  const url = `${ECFR_BASE_URL}/structure/${date}/title-${titleNumber}.json`;

  return retryWithBackoff(async () => {
    console.log(`[eCFR] Fetching structure for title ${titleNumber} from ${url}`);

    const response = await fetch(url);

    if (response.status === 404) {
      throw new ECFRFetchError(
        404,
        titleNumber,
        `CFR title ${titleNumber} structure not found`
      );
    }

    if (!response.ok) {
      throw new ECFRFetchError(
        response.status,
        titleNumber,
        `Failed to fetch CFR title ${titleNumber} structure: ${response.statusText}`
      );
    }

    // Response is the structure directly at root level
    const data = await response.json() as {
      type?: string;
      identifier?: string;
      children?: Array<{
        type?: string;
        identifier?: string;
        children?: Array<any>;
      }>;
    };

    // Extract part numbers from structure
    // Structure is hierarchical: title > chapter > subchapter > part
    const parts: number[] = [];

    function extractParts(node: any): void {
      if (!node) return;

      // Check if this node is a part
      if (node.type === 'part' && node.identifier) {
        const partNum = parseInt(node.identifier, 10);
        if (!isNaN(partNum)) {
          parts.push(partNum);
        }
      }

      // Recurse into children
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          extractParts(child);
        }
      }
    }

    // Start from the root (title level)
    extractParts(data);

    console.log(`[eCFR] Found ${parts.length} parts in title ${titleNumber}`);

    return { parts: parts.sort((a, b) => a - b) };
  }, `fetchCFRTitleStructure(${titleNumber})`);
}

/**
 * Fetch list of all CFR titles from eCFR API
 *
 * @returns Array of title numbers and names
 */
export async function fetchCFRTitleList(): Promise<{ number: number; name: string }[]> {
  const url = `${ECFR_BASE_URL}/titles`;

  return retryWithBackoff(async () => {
    console.log(`[eCFR] Fetching title list from ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new ECFRFetchError(
        response.status,
        'title-list',
        `Failed to fetch CFR title list: ${response.statusText}`
      );
    }

    const data = await response.json() as { titles?: { number: number; name: string }[] };

    // eCFR API returns: { titles: [{ number: 1, name: "General Provisions" }, ...] }
    if (!data.titles || !Array.isArray(data.titles)) {
      throw new Error('Invalid response format from eCFR API');
    }

    return data.titles.map((title) => ({
      number: title.number,
      name: title.name,
    }));
  }, 'fetchCFRTitleList');
}

/**
 * Fetch full XML for a specific CFR title
 *
 * @param titleNumber - CFR title number (e.g., 21 for Food and Drugs)
 * @returns Raw XML string
 */
export async function fetchCFRTitle(titleNumber: number): Promise<string> {
  const date = await getAvailableDateFromAPI();
  const url = `${ECFR_BASE_URL}/full/${date}/title-${titleNumber}.xml`;

  return retryWithBackoff(async () => {
    console.log(`[eCFR] Fetching title ${titleNumber} from ${url}`);

    const response = await fetch(url);

    if (response.status === 404) {
      throw new ECFRFetchError(
        404,
        titleNumber,
        `CFR title ${titleNumber} not found`
      );
    }

    if (response.status === 429) {
      throw new ECFRFetchError(
        429,
        titleNumber,
        `Rate limited by eCFR API for title ${titleNumber}`
      );
    }

    if (!response.ok) {
      throw new ECFRFetchError(
        response.status,
        titleNumber,
        `Failed to fetch CFR title ${titleNumber}: ${response.statusText}`
      );
    }

    return await response.text();
  }, `fetchCFRTitle(${titleNumber})`);
}

/**
 * Fetch XML for a specific part within a CFR title
 *
 * @param titleNumber - CFR title number
 * @param partNumber - Part number within the title
 * @returns Raw XML string
 */
export async function fetchCFRPart(titleNumber: number, partNumber: number): Promise<string> {
  const date = await getAvailableDateFromAPI();
  const url = `${ECFR_BASE_URL}/full/${date}/title-${titleNumber}.xml?part=${partNumber}`;

  return retryWithBackoff(async () => {
    console.log(`[eCFR] Fetching title ${titleNumber} part ${partNumber} from ${url}`);

    const response = await fetch(url);

    if (response.status === 404) {
      throw new ECFRFetchError(
        404,
        `${titleNumber}-${partNumber}`,
        `CFR title ${titleNumber} part ${partNumber} not found`
      );
    }

    if (response.status === 429) {
      throw new ECFRFetchError(
        429,
        `${titleNumber}-${partNumber}`,
        `Rate limited by eCFR API for title ${titleNumber} part ${partNumber}`
      );
    }

    if (!response.ok) {
      throw new ECFRFetchError(
        response.status,
        `${titleNumber}-${partNumber}`,
        `Failed to fetch CFR title ${titleNumber} part ${partNumber}: ${response.statusText}`
      );
    }

    return await response.text();
  }, `fetchCFRPart(${titleNumber}, ${partNumber})`);
}

/**
 * CFR structure types
 */
export interface CFRTitle {
  number: number;
  name: string;
  effectiveDate?: string;
  parts: CFRPart[];
}

export interface CFRPart {
  number: number;
  name: string;
  sections: CFRSection[];
}

export interface CFRSection {
  number: string;
  heading: string;
  text: string;
  subsections?: CFRSubsection[];
  effectiveDate?: string;
  lastAmended?: string;
}

export interface CFRSubsection {
  id: string; // e.g., "(a)", "(b)", "(1)", "(i)"
  text: string;
}

/**
 * Parse CFR XML into structured format
 * Handles both full title XML (<ECFR><DIV1>...) and part-specific XML (<DIV5>...)
 *
 * @param xml - Raw XML string from eCFR API
 * @returns Parsed CFR title structure
 */
export function parseCFRXML(xml: string): CFRTitle {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '_text',
  });

  const parsed = parser.parse(xml);

  // Check if this is part-level XML (starts with DIV5)
  // Part XML structure: <DIV5 N="1" TYPE="PART">...</DIV5>
  if (parsed.DIV5 && parsed.DIV5['@_TYPE'] === 'PART') {
    return parseCFRPartXML(parsed.DIV5);
  }

  // Otherwise, expect full title XML
  // eCFR XML structure: <ECFR><DIV1 TYPE="TITLE" N="27">...</DIV1></ECFR>
  const titleXML = parsed.ECFR?.DIV1;

  if (!titleXML) {
    throw new Error('Invalid CFR XML: DIV1 (TITLE) element not found');
  }

  // Title number from N attribute, title name from HEAD element
  const titleNumber = parseInt(titleXML['@_N'] || '0', 10);
  const headText = titleXML.HEAD?._text || titleXML.HEAD || '';
  // HEAD format: "Title 27—Alcohol, Tobacco Products and Firearms"
  const titleName = typeof headText === 'string'
    ? headText.replace(/^Title \d+[—-]/, '').trim() || `Title ${titleNumber}`
    : `Title ${titleNumber}`;

  // Extract parts from the XML
  const parts = extractParts(titleXML);

  return {
    number: titleNumber,
    name: titleName,
    parts,
  };
}

/**
 * Parse part-level CFR XML (DIV5) into a pseudo-title structure
 * Used when fetching individual parts via the ?part= parameter
 *
 * @param partXML - Parsed DIV5 element
 * @returns Pseudo CFR title structure containing just this part
 */
function parseCFRPartXML(partXML: any): CFRTitle {
  const partNumber = parseInt(partXML['@_N'] || '0', 10);
  const headText = partXML.HEAD?._text || partXML.HEAD || '';
  // HEAD format: "PART 1—BASIC PERMIT REQUIREMENTS..."
  const partName = typeof headText === 'string'
    ? headText.replace(/^PART \d+[—-]?/, '').trim() || `Part ${partNumber}`
    : `Part ${partNumber}`;

  // Extract sections from this part
  const sections = extractSections(partXML);

  // Return as a pseudo-title containing just this part
  return {
    number: 0, // Will be filled in by caller with actual title number
    name: '', // Will be filled in by caller
    parts: [{
      number: partNumber,
      name: partName,
      sections,
    }],
  };
}

/**
 * Extract all parts from a title XML structure
 *
 * @param titleXML - Parsed title XML object
 * @returns Array of CFR parts
 */
export function extractParts(titleXML: any): CFRPart[] {
  const parts: CFRPart[] = [];

  // eCFR XML uses DIV hierarchy: DIV1 (title) > DIV3 (chapter) > DIV4 (subchapter) > DIV5 (part)
  // Parts have TYPE="PART" attribute and can be at different DIV levels
  // Sections are in DIV8 with TYPE="SECTION"

  function findParts(node: any): void {
    if (!node) return;

    // Check if this is a part DIV (any DIV with TYPE="PART")
    if (node['@_TYPE'] === 'PART') {
      const partNumber = parseInt(node['@_N'] || '0', 10);
      const headText = node.HEAD?._text || node.HEAD || '';
      // HEAD format: "PART 1—BASIC PERMIT REQUIREMENTS..."
      const partName = typeof headText === 'string'
        ? headText.replace(/^PART \d+[—-]?/, '').trim() || `Part ${partNumber}`
        : `Part ${partNumber}`;

      // Extract sections from this part
      const sections = extractSections(node);

      parts.push({
        number: partNumber,
        name: partName,
        sections,
      });
      return; // Don't recurse into parts
    }

    // Recursively search child DIVs
    for (const key of Object.keys(node)) {
      if (key.startsWith('DIV')) {
        const childDivs = Array.isArray(node[key]) ? node[key] : [node[key]];
        childDivs.forEach(findParts);
      }
    }
  }

  findParts(titleXML);

  return parts;
}

/**
 * Extract all sections from a part XML structure
 *
 * @param partXML - Parsed part XML object
 * @returns Array of CFR sections
 */
export function extractSections(partXML: any): CFRSection[] {
  const sections: CFRSection[] = [];

  // Sections are DIV8 elements with TYPE="SECTION"
  function findSections(node: any): void {
    if (!node) return;

    // Check if this is a section DIV (DIV8 with TYPE="SECTION")
    if (node['@_TYPE'] === 'SECTION') {
      // Section number from N attribute (e.g., "1.1")
      const sectionNumber = node['@_N'] || '';

      // HEAD contains both section number and heading: "§ 1.1   General."
      const headText = node.HEAD?._text || node.HEAD || '';
      let heading = '';
      if (typeof headText === 'string') {
        // Remove the "§ X.X" prefix to get just the heading
        heading = headText.replace(/^§\s*[\d.]+\s*/, '').trim();
      }

      // Extract text from P (paragraph) and FP (flush paragraph) elements
      const paragraphs: string[] = [];

      function extractText(textNode: any): void {
        if (!textNode) return;

        // Handle P elements
        if (textNode.P) {
          const pElements = Array.isArray(textNode.P) ? textNode.P : [textNode.P];
          pElements.forEach((p: any) => {
            const pText = typeof p === 'string' ? p : (p._text || '');
            if (pText) {
              paragraphs.push(pText);
            }
          });
        }

        // Handle FP elements (flush paragraphs)
        if (textNode.FP) {
          const fpElements = Array.isArray(textNode.FP) ? textNode.FP : [textNode.FP];
          fpElements.forEach((fp: any) => {
            const fpText = typeof fp === 'string' ? fp : (fp._text || '');
            if (fpText) {
              paragraphs.push(fpText);
            }
          });
        }

        // Recursively extract from child elements (but not P or FP again)
        for (const key of Object.keys(textNode)) {
          if (typeof textNode[key] === 'object' && key !== 'P' && key !== 'FP' && !key.startsWith('@_')) {
            if (Array.isArray(textNode[key])) {
              textNode[key].forEach(extractText);
            } else {
              extractText(textNode[key]);
            }
          }
        }
      }

      extractText(node);
      const text = paragraphs.join('\n\n');

      // Only add sections that have content
      if (sectionNumber || heading || text) {
        sections.push({
          number: sectionNumber.trim(),
          heading: heading,
          text: text.trim(),
        });
      }
    }

    // Recursively search child DIVs
    for (const key of Object.keys(node)) {
      if (key.startsWith('DIV')) {
        const childDivs = Array.isArray(node[key]) ? node[key] : [node[key]];
        childDivs.forEach(findSections);
      }
    }
  }

  findSections(partXML);

  return sections;
}
