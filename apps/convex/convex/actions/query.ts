"use node";

import { action } from '../_generated/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';

import { geocodeAddress, getFallbackJurisdictions } from '../lib/geocode';
import { embedQuery } from '../lib/embed';
import { retrieveChunks } from '../lib/retrieve';
import { calculateConfidence } from '../lib/confidence';
import { buildSystemPrompt, buildUserPrompt } from '../lib/prompt';
import { generateAnswer } from '../lib/generate';
import { parseAnswer } from '../lib/parse';
import type {
  QueryResult,
  GeneratedAnswer,
} from '../query/types';

/**
 * Main query action - orchestrates the full RAG pipeline.
 *
 * Pipeline steps:
 * 1. Geocode address -> jurisdictions
 * 2. Embed query -> vector
 * 3. Retrieve chunks from Pinecone
 * 4. Calculate confidence from retrieval
 * 5. Build system + user prompts
 * 6. Generate answer with Claude
 * 7. Parse answer into structured format
 * 8. Persist to Convex
 *
 * @param question - Natural language compliance question
 * @param address - Optional address for jurisdiction resolution
 * @param conversationId - Optional conversation ID for context
 * @returns QueryResult with answer, citations, permits, and metadata
 */
export const processQuery = action({
  args: {
    question: v.string(),
    address: v.optional(v.string()),
    conversationId: v.optional(v.id('conversations')),
  },
  handler: async (ctx, args): Promise<QueryResult> => {
    const startTime = Date.now();

    // Get API keys from environment
    const geocodioKey = process.env.GEOCODIO_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const pineconeKey = process.env.PINECONE_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!openaiKey || !pineconeKey || !anthropicKey) {
      throw new Error(
        'Missing required API keys (OPENAI_API_KEY, PINECONE_API_KEY, ANTHROPIC_API_KEY)'
      );
    }

    // Step 1: Geocode address to jurisdictions
    let jurisdictionResult = getFallbackJurisdictions();
    if (args.address && geocodioKey) {
      try {
        jurisdictionResult = await geocodeAddress(args.address, geocodioKey);
      } catch (error) {
        console.warn('Geocoding failed, using federal-only fallback:', error);
      }
    }
    const { jurisdictions } = jurisdictionResult;

    // Step 2: Generate query embedding
    const queryEmbedding = await embedQuery(args.question, openaiKey);

    // Step 3: Retrieve relevant chunks from Pinecone
    const chunks = await retrieveChunks(
      queryEmbedding,
      jurisdictions,
      pineconeKey,
      { topK: 50, minScore: 0.5, rerank: true, finalTopK: 15 }
    );

    // Step 4: Calculate confidence based on retrieval
    const confidence = calculateConfidence(chunks, jurisdictions);

    // Step 5: Build prompts
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(args.question, chunks, jurisdictions);

    // Step 6: Generate answer with Claude
    const rawAnswer = await generateAnswer(systemPrompt, userPrompt, anthropicKey);

    // Step 7: Parse answer into structured format
    const parsed = parseAnswer(rawAnswer, chunks);

    // Log any warnings
    if (parsed.warnings.length > 0) {
      console.warn('Answer parsing warnings:', parsed.warnings);
    }

    // Build GeneratedAnswer
    const answer: GeneratedAnswer = {
      summary: extractSummary(rawAnswer), // First paragraph or first 500 chars
      sections: parsed.sections,
      permits: parsed.permits,
      citations: parsed.citations,
      confidence,
    };

    // Step 8: Persist to Convex
    const { conversationId, messageId } = await ctx.runMutation(
      internal.mutations.saveQuery.saveQueryResult,
      {
        conversationId: args.conversationId,
        question: args.question,
        address: args.address,
        jurisdictions,
        answerContent: rawAnswer,
        citations: parsed.citations,
        permits: parsed.permits,
        confidence: {
          level: confidence.level,
          score: confidence.score,
          reason: confidence.reason,
        },
        processingTimeMs: Date.now() - startTime,
      }
    );

    const processingTimeMs = Date.now() - startTime;

    return {
      queryId: messageId,
      question: args.question,
      address: args.address,
      jurisdictions,
      answer,
      retrievedChunks: chunks,
      processingTimeMs,
    };
  },
});

/**
 * Helper: Extract summary from answer (first paragraph)
 */
function extractSummary(text: string): string {
  const firstParagraph = text.split('\n\n')[0] || text;
  if (firstParagraph.length <= 500) {
    return firstParagraph;
  }
  return firstParagraph.substring(0, 500) + '...';
}
