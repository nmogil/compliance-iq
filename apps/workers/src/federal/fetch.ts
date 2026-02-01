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
 * Get current date in YYYY-MM-DD format for eCFR API
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
  const date = getCurrentDateString();
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
  const date = getCurrentDateString();
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

  // Navigate to the title structure
  // eCFR XML structure: <CFRDOC><TITLE>...</TITLE></CFRDOC>
  const titleXML = parsed.CFRDOC?.TITLE;

  if (!titleXML) {
    throw new Error('Invalid CFR XML: TITLE element not found');
  }

  const titleNumber = parseInt(titleXML['@_N'] || '0', 10);
  const titleName = titleXML.RESERVED?._text || `Title ${titleNumber}`;

  // Extract parts from the XML
  const parts = extractParts(titleXML);

  return {
    number: titleNumber,
    name: titleName,
    parts,
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

  // CFR XML uses DIV hierarchy: DIV1 (title) > DIV3 (chapter) > DIV5 (subchapter) > DIV6 (part)
  // Not all titles have all levels - we need to search recursively for DIV6 (part)

  function findParts(node: any): void {
    if (!node) return;

    // Check if this is a part DIV (DIV6 with TYPE="PART")
    if (node['@_TYPE'] === 'PART') {
      const partNumber = parseInt(node['@_N'] || '0', 10);
      const partName = node.HEAD?._text || `Part ${partNumber}`;

      // Extract sections from this part
      const sections = extractSections(node);

      parts.push({
        number: partNumber,
        name: partName,
        sections,
      });
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
 * @param partXML - Parsed part XML object (DIV6)
 * @returns Array of CFR sections
 */
export function extractSections(partXML: any): CFRSection[] {
  const sections: CFRSection[] = [];

  // Sections are typically DIV8 elements with TYPE="SECTION"
  function findSections(node: any): void {
    if (!node) return;

    // Check if this is a section DIV (DIV8 with TYPE="SECTION")
    if (node['@_TYPE'] === 'SECTION') {
      const sectionNumber = node.SECTNO?._text || node['@_N'] || '';
      const heading = node.SUBJECT?._text || '';

      // Extract text from P (paragraph) and FP (flush paragraph) elements
      let text = '';
      const paragraphs: string[] = [];

      function extractText(node: any): void {
        if (!node) return;

        if (node.P) {
          const pElements = Array.isArray(node.P) ? node.P : [node.P];
          pElements.forEach((p: any) => {
            if (p._text) {
              paragraphs.push(p._text);
            }
          });
        }

        if (node.FP) {
          const fpElements = Array.isArray(node.FP) ? node.FP : [node.FP];
          fpElements.forEach((fp: any) => {
            if (fp._text) {
              paragraphs.push(fp._text);
            }
          });
        }

        // Recursively extract from child elements
        for (const key of Object.keys(node)) {
          if (typeof node[key] === 'object' && key !== 'P' && key !== 'FP') {
            extractText(node[key]);
          }
        }
      }

      extractText(node);
      text = paragraphs.join('\n\n');

      // Extract effective date and last amended from XML attributes
      const effectiveDate = node['@_EFFECTIVE'];
      const lastAmended = node['@_AMENDED'];

      sections.push({
        number: sectionNumber.trim(),
        heading: heading.trim(),
        text: text.trim(),
        effectiveDate,
        lastAmended,
      });
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
