import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

/**
 * Jurisdictions: CRUD operations for regulatory bodies
 */

/**
 * List all jurisdictions, optionally filtered by type or active status
 */
export const list = query({
  args: {
    type: v.optional(
      v.union(
        v.literal('federal'),
        v.literal('state'),
        v.literal('county'),
        v.literal('city')
      )
    ),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query('jurisdictions');

    if (args.type !== undefined) {
      query = query.withIndex('by_type', (q) => q.eq('type', args.type));
    }

    if (args.isActive !== undefined) {
      query = query.withIndex('by_active', (q) =>
        q.eq('isActive', args.isActive)
      );
    }

    return await query.collect();
  },
});

/**
 * Get a single jurisdiction by ID
 */
export const get = query({
  args: { id: v.id('jurisdictions') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Add a new jurisdiction
 */
export const add = mutation({
  args: {
    name: v.string(),
    type: v.union(
      v.literal('federal'),
      v.literal('state'),
      v.literal('county'),
      v.literal('city')
    ),
    stateCode: v.optional(v.string()),
    countyFips: v.optional(v.string()),
    cityName: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    return await ctx.db.insert('jurisdictions', {
      name: args.name,
      type: args.type,
      stateCode: args.stateCode,
      countyFips: args.countyFips,
      cityName: args.cityName,
      isActive: args.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update jurisdiction active status
 */
export const updateStatus = mutation({
  args: {
    id: v.id('jurisdictions'),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      isActive: args.isActive,
      updatedAt: Date.now(),
    });
  },
});
