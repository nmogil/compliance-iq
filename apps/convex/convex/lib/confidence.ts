import type { RetrievedChunk, ConfidenceScore } from '../query/types';

/**
 * Confidence Scoring for RAG Retrieval
 *
 * Calculates confidence in answer quality based on RETRIEVAL METRICS only.
 * This is NOT LLM self-assessment - research shows LLMs overestimate confidence.
 *
 * Metrics:
 * 1. Average semantic similarity (how well chunks match query)
 * 2. Jurisdiction coverage (what % of target jurisdictions are represented)
 * 3. Citation coverage (what % of chunks have valid citations)
 */

// Scoring weights
const SIMILARITY_WEIGHT = 0.5; // 50% - semantic relevance is most important
const COVERAGE_WEIGHT = 0.3; // 30% - jurisdiction completeness matters
const CITATION_WEIGHT = 0.2; // 20% - citation quality ensures traceability

// Classification thresholds
const HIGH_THRESHOLD = 0.8; // Above 0.8 = High confidence
const MEDIUM_THRESHOLD = 0.6; // Above 0.6 = Medium confidence

/**
 * Calculate retrieval-based confidence score for a set of retrieved chunks.
 *
 * Confidence is based on:
 * - How semantically similar the chunks are to the query (higher = better)
 * - How many of the target jurisdictions are represented (more = better)
 * - How many chunks have valid citations (more = better)
 *
 * @param chunks - Retrieved chunks from Pinecone
 * @param targetJurisdictions - Jurisdictions we wanted to retrieve for (e.g., ["US", "TX", "TX-48201"])
 * @returns ConfidenceScore with level, numeric score, explanation, and underlying metrics
 */
export function calculateConfidence(
  chunks: RetrievedChunk[],
  targetJurisdictions: string[]
): ConfidenceScore {
  // Metric 1: Average Semantic Similarity
  // Higher similarity scores mean chunks are more relevant to the query
  const avgSimilarity =
    chunks.length > 0
      ? chunks.reduce((sum, c) => sum + c.score, 0) / chunks.length
      : 0;

  // Metric 2: Jurisdiction Coverage
  // What percentage of target jurisdictions are represented in the results?
  const representedJurisdictions = new Set(chunks.map((c) => c.jurisdiction));
  const jurisdictionCoverage =
    targetJurisdictions.length > 0
      ? representedJurisdictions.size / targetJurisdictions.length
      : 0;

  // Metric 3: Citation Coverage
  // What percentage of chunks have valid citations?
  const chunksWithCitations = chunks.filter(
    (c) => c.citation && c.citation.length > 0
  );
  const citationCoverage =
    chunks.length > 0 ? chunksWithCitations.length / chunks.length : 0;

  // Combined weighted score
  const score =
    avgSimilarity * SIMILARITY_WEIGHT +
    jurisdictionCoverage * COVERAGE_WEIGHT +
    citationCoverage * CITATION_WEIGHT;

  // Classify confidence level
  let level: 'High' | 'Medium' | 'Low';
  if (score > HIGH_THRESHOLD && jurisdictionCoverage === 1.0) {
    // High confidence requires excellent score AND full jurisdiction coverage
    level = 'High';
  } else if (score > MEDIUM_THRESHOLD) {
    level = 'Medium';
  } else {
    level = 'Low';
  }

  // Generate human-readable explanation
  const reason = `${level}: ${representedJurisdictions.size}/${targetJurisdictions.length} jurisdictions covered, avg similarity ${avgSimilarity.toFixed(2)}, ${(citationCoverage * 100).toFixed(0)}% chunks have citations`;

  return {
    level,
    score,
    reason,
    metrics: {
      avgSimilarity,
      jurisdictionCoverage,
      citationCoverage,
    },
  };
}
