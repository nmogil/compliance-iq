import type { RetrievedChunk } from '../query/types';

/**
 * Claude Prompt Templates for RAG Answer Generation
 *
 * Prompts instruct Claude to:
 * - Generate jurisdiction-layered responses (Federal, State, County, Municipal)
 * - Use inline citations in [N] format for all factual claims
 * - List required permits in a dedicated section
 * - Organize answers by regulatory hierarchy
 */

/**
 * System prompt for Claude RAG answer generation.
 * Sets role, citation rules, response structure, and important guidelines.
 */
export const SYSTEM_PROMPT = `You are a legal compliance research assistant for ComplianceIQ. Your role is to answer regulatory compliance questions for lawyers using ONLY the provided regulatory text.

## Citation Rules
- Cite ALL factual claims using [N] format where N is the source number
- Example: "Food facilities must register with FDA [1] and maintain written food safety plans [2]."
- NEVER make claims without citations
- If information is not in the provided sources, state "Not found in available sources"

## Response Structure
Organize your response into sections by jurisdiction level:

### Federal
[Federal regulations that apply]

### State
[State statutes and administrative code that apply]

### County (if applicable)
[County ordinances that apply]

### Municipal (if applicable)
[City codes that apply]

### Required Permits and Licenses
For each permit/license identified:
- **Permit Name**: [name]
- **Issuing Agency**: [agency name]
- **Jurisdiction**: [federal/state/county/municipal]
- **Link**: [URL if available]
- **Regulatory Reference**: [citation]

## Important
- Be precise with citations - use exact section numbers from the metadata
- If regulations conflict or overlap, explain which takes precedence
- If coverage for a jurisdiction is incomplete, note: "Additional [jurisdiction] requirements may apply"
- Keep answers focused on the specific question asked`;

/**
 * Build system prompt for Claude.
 * Currently returns static SYSTEM_PROMPT.
 * Future: May add customization based on query context.
 */
export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/**
 * Build user prompt with question, numbered chunks, and jurisdictions context.
 *
 * Chunks are numbered [1], [2], [3] for citation tracking.
 * Each chunk includes citation, jurisdiction, sourceType, optional title, and text content.
 *
 * @param question - Natural language compliance question
 * @param chunks - Retrieved chunks from Pinecone
 * @param jurisdictions - Target jurisdictions for query (e.g., ["US", "TX", "TX-houston"])
 * @returns Formatted user prompt with numbered regulatory sources
 */
export function buildUserPrompt(
  question: string,
  chunks: RetrievedChunk[],
  jurisdictions: string[]
): string {
  // Number chunks for citation tracking
  const numberedChunks = chunks
    .map((chunk, i) => {
      const header = `[${i + 1}] ${chunk.citation} (${chunk.jurisdiction}, ${chunk.sourceType})`;
      const title = chunk.title ? `\nTitle: ${chunk.title}` : '';
      return `${header}${title}\n\n${chunk.text}`;
    })
    .join('\n\n---\n\n');

  // Build jurisdictions context
  const jurisdictionContext =
    jurisdictions.length > 0
      ? `\nRelevant jurisdictions: ${jurisdictions.join(', ')}`
      : '';

  return `Question: ${question}${jurisdictionContext}

## Regulatory Sources (cite using [N] format)

${numberedChunks}

## Instructions
Answer the question using ONLY the sources above. Organize by jurisdiction level (Federal, State, County, Municipal). List all required permits and licenses in a dedicated section at the end.`;
}

/**
 * Build formatted citation list for UI/CLI display.
 *
 * Returns numbered citation references that map to [N] format in answer text.
 * Used by test-query.ts script and will be used by frontend components for citation footnotes.
 *
 * @param chunks - Retrieved chunks from Pinecone
 * @returns Formatted citation list (e.g., "[1] 21 C.F.R. § 117.5 (US, federal)")
 */
export function buildCitationList(chunks: RetrievedChunk[]): string {
  return chunks
    .map((chunk, i) => {
      const jurisdiction =
        chunk.jurisdiction === 'US' ? 'US' : chunk.jurisdiction;
      return `[${i + 1}] ${chunk.citation} (${jurisdiction}, ${chunk.sourceType})`;
    })
    .join('\n');
}
