import { query } from '../_generated/server';
import { v } from 'convex/values';

/**
 * Get user's conversation history
 * Note: userId is placeholder until auth in Phase 8
 */
export const getUserHistory = query({
  args: {
    userId: v.optional(v.string()),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;

    // Get conversations (optionally filtered by user)
    let conversations;

    if (args.userId) {
      const userId = args.userId; // Capture for type narrowing
      conversations = await ctx.db
        .query('conversations')
        .withIndex('by_user', q => q.eq('userId', userId))
        .order('desc')
        .take(limit);
    } else {
      conversations = await ctx.db
        .query('conversations')
        .order('desc')
        .take(limit);
    }

    // Get first message of each conversation for preview
    const history = await Promise.all(
      conversations.map(async (conv) => {
        const messages = await ctx.db
          .query('messages')
          .withIndex('by_conversation', q => q.eq('conversationId', conv._id))
          .order('asc')
          .take(1);

        return {
          conversation: conv,
          preview: messages[0]?.content?.substring(0, 100) ?? ''
        };
      })
    );

    return history;
  }
});
