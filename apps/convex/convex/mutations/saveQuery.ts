import { internalMutation } from '../_generated/server';
import { v } from 'convex/values';

/**
 * Internal mutation for persisting query results to conversations and messages.
 * Called by the query action after generating an answer.
 */
export const saveQueryResult = internalMutation({
  args: {
    conversationId: v.optional(v.id('conversations')),
    question: v.string(),
    address: v.optional(v.string()),
    jurisdictions: v.array(v.string()),
    answerContent: v.string(),
    citations: v.array(
      v.object({
        id: v.number(),
        citation: v.string(),
        text: v.string(),
        url: v.optional(v.string()),
        jurisdiction: v.string(),
        sourceType: v.union(
          v.literal('federal'),
          v.literal('state'),
          v.literal('county'),
          v.literal('municipal')
        ),
      })
    ),
    permits: v.array(
      v.object({
        name: v.string(),
        issuingAgency: v.string(),
        jurisdiction: v.string(),
        url: v.optional(v.string()),
        citation: v.string(),
      })
    ),
    confidence: v.object({
      level: v.union(v.literal('High'), v.literal('Medium'), v.literal('Low')),
      score: v.number(),
      reason: v.string(),
    }),
    processingTimeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Create or use existing conversation
    let conversationId = args.conversationId;
    if (!conversationId) {
      // Create new conversation with question as title
      const title =
        args.question.length > 50
          ? args.question.substring(0, 50) + '...'
          : args.question;
      conversationId = await ctx.db.insert('conversations', {
        userId: 'system', // Will be replaced with auth in Phase 8
        title,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Save user question as message
    await ctx.db.insert('messages', {
      conversationId,
      role: 'user',
      content: args.question,
      status: 'complete',
      createdAt: now,
      updatedAt: now,
    });

    // Save assistant response as message
    // Note: We store simplified citations in the message format
    const messageCitations = args.citations.map((c) => ({
      sourceId: '0'.repeat(32) as any, // Placeholder - we don't have source IDs yet
      sectionNumber: c.citation,
      title: c.text.substring(0, 100),
      url: c.url ?? '',
      relevanceScore: undefined,
    }));

    const messageId = await ctx.db.insert('messages', {
      conversationId,
      role: 'assistant',
      content: args.answerContent,
      status: 'complete',
      citations: messageCitations.length > 0 ? messageCitations : undefined,
      createdAt: now,
      updatedAt: now,
    });

    // Update conversation timestamp
    await ctx.db.patch(conversationId, { updatedAt: now });

    return { conversationId, messageId };
  },
});
