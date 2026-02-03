import { query } from '../_generated/server';
import { v } from 'convex/values';

/**
 * Get all messages for a conversation (query + answer pairs)
 */
export const getQueryByConversation = query({
  args: {
    conversationId: v.id('conversations')
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get(args.conversationId);
    if (!conversation) {
      return null;
    }

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_conversation', q => q.eq('conversationId', args.conversationId))
      .order('asc')
      .collect();

    return {
      conversation,
      messages
    };
  }
});

/**
 * Get the most recent query (last conversation with messages)
 */
export const getLatestQuery = query({
  args: {},
  handler: async (ctx) => {
    // Get most recent conversation
    const conversations = await ctx.db
      .query('conversations')
      .order('desc')
      .take(1);

    if (conversations.length === 0) {
      return null;
    }

    const conversation = conversations[0];
    if (!conversation) {
      return null;
    }

    const messages = await ctx.db
      .query('messages')
      .withIndex('by_conversation', q => q.eq('conversationId', conversation._id))
      .order('asc')
      .collect();

    return {
      conversation,
      messages
    };
  }
});
