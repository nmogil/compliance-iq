import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude Answer Generation
 *
 * Non-streaming answer generation using Claude API.
 * Streaming is deferred to Phase 9 (QUERY-05).
 */

// Generation constants
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0; // Factual accuracy

/**
 * Error class for answer generation failures.
 */
export class GenerationError extends Error {
  public readonly code: 'API_ERROR' | 'CONTENT_FILTER' | 'RATE_LIMIT' | 'TIMEOUT';
  public override readonly cause?: unknown;

  constructor(
    message: string,
    code: 'API_ERROR' | 'CONTENT_FILTER' | 'RATE_LIMIT' | 'TIMEOUT',
    cause?: unknown
  ) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Generate a cited compliance answer using Claude API.
 *
 * @param systemPrompt - System instructions for Claude
 * @param userPrompt - User question with retrieved context
 * @param apiKey - Anthropic API key
 * @returns Generated answer text with citations
 * @throws {GenerationError} If generation fails
 */
export async function generateAnswer(
  systemPrompt: string,
  userPrompt: string,
  apiKey: string
): Promise<string> {
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new GenerationError('No text in response', 'API_ERROR');
    }

    return textBlock.text;
  } catch (error) {
    // Re-throw if already a GenerationError
    if (error instanceof GenerationError) throw error;

    // Handle Anthropic API errors
    const err = error as any;

    if (err?.status === 429) {
      throw new GenerationError('Rate limit exceeded', 'RATE_LIMIT', error);
    }

    if (err?.status === 400 && err?.error?.type === 'invalid_request_error') {
      throw new GenerationError('Content filter triggered', 'CONTENT_FILTER', error);
    }

    // Generic API error
    throw new GenerationError('Failed to generate answer', 'API_ERROR', error);
  }
}
