import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

/**
 * Messages: CRUD operations for conversation messages
 */

/**
 * Get all messages in a conversation, ordered by creation time
 */
export const byConversation = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .order("asc")
      .collect();
  },
});

/**
 * Get a single message by ID
 */
export const get = query({
  args: { id: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Send a new message in a conversation
 */
export const send = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("complete"),
        v.literal("error")
      )
    ),
    citations: v.optional(
      v.array(
        v.object({
          sourceId: v.id("sources"),
          sectionNumber: v.string(),
          title: v.string(),
          url: v.string(),
          relevanceScore: v.optional(v.number()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Update conversation timestamp
    await ctx.db.patch(args.conversationId, {
      updatedAt: now,
    });

    return await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      role: args.role,
      content: args.content,
      status: args.status ?? "complete",
      citations: args.citations,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update message status and content (for streaming responses)
 */
export const updateStatus = mutation({
  args: {
    id: v.id("messages"),
    status: v.union(
      v.literal("pending"),
      v.literal("complete"),
      v.literal("error")
    ),
    content: v.optional(v.string()),
    citations: v.optional(
      v.array(
        v.object({
          sourceId: v.id("sources"),
          sectionNumber: v.string(),
          title: v.string(),
          url: v.string(),
          relevanceScore: v.optional(v.number()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const update: any = {
      status: args.status,
      updatedAt: Date.now(),
    };

    if (args.content !== undefined) {
      update.content = args.content;
    }

    if (args.citations !== undefined) {
      update.citations = args.citations;
    }

    await ctx.db.patch(args.id, update);
  },
});
