import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

/**
 * Sources: CRUD operations for regulatory data sources
 */

/**
 * List all sources, optionally filtered by jurisdiction or status
 */
export const list = query({
  args: {
    jurisdictionId: v.optional(v.id('jurisdictions')),
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('active'),
        v.literal('complete'),
        v.literal('error')
      )
    ),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query('sources');

    if (args.jurisdictionId !== undefined) {
      query = query.withIndex('by_jurisdiction', (q) =>
        q.eq('jurisdictionId', args.jurisdictionId)
      );
    }

    if (args.status !== undefined) {
      query = query.withIndex('by_status', (q) => q.eq('status', args.status));
    }

    return await query.collect();
  },
});

/**
 * Get a single source by ID
 */
export const get = query({
  args: { id: v.id('sources') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Add a new source
 */
export const add = mutation({
  args: {
    jurisdictionId: v.id('jurisdictions'),
    name: v.string(),
    url: v.string(),
    sourceType: v.union(
      v.literal('statutes'),
      v.literal('regulations'),
      v.literal('ordinances'),
      v.literal('other')
    ),
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('active'),
        v.literal('complete'),
        v.literal('error')
      )
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    return await ctx.db.insert('sources', {
      jurisdictionId: args.jurisdictionId,
      name: args.name,
      url: args.url,
      sourceType: args.sourceType,
      status: args.status ?? 'pending',
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Update source status
 */
export const updateStatus = mutation({
  args: {
    id: v.id('sources'),
    status: v.union(
      v.literal('pending'),
      v.literal('active'),
      v.literal('complete'),
      v.literal('error')
    ),
    lastScrapedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      lastScrapedAt: args.lastScrapedAt,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Update federal data pipeline status
 * Called by Cloudflare Workers after processing CFR titles
 */
export const updateFederalStatus = mutation({
  args: {
    status: v.union(
      v.literal('pending'),
      v.literal('active'),
      v.literal('complete'),
      v.literal('error')
    ),
    lastScrapedAt: v.number(),
    titlesProcessed: v.optional(v.number()),
    totalVectors: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Find or create the federal CFR source record
    const existingSource = await ctx.db
      .query('sources')
      .filter((q) => q.eq(q.field('name'), 'Federal CFR'))
      .first();

    const now = Date.now();

    if (existingSource) {
      // Update existing record
      await ctx.db.patch(existingSource._id, {
        status: args.status,
        lastScrapedAt: args.lastScrapedAt,
        updatedAt: now,
      });
      return existingSource._id;
    } else {
      // Create new record - need a federal jurisdiction first
      // Look for existing US federal jurisdiction or create placeholder
      let federalJurisdiction = await ctx.db
        .query('jurisdictions')
        .filter((q) => q.eq(q.field('name'), 'United States'))
        .first();

      if (!federalJurisdiction) {
        const jurisdictionId = await ctx.db.insert('jurisdictions', {
          name: 'United States',
          type: 'federal',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        federalJurisdiction = await ctx.db.get(jurisdictionId);
      }

      // Create federal source record
      return await ctx.db.insert('sources', {
        jurisdictionId: federalJurisdiction!._id,
        name: 'Federal CFR',
        url: 'https://www.ecfr.gov',
        sourceType: 'regulations',
        status: args.status,
        lastScrapedAt: args.lastScrapedAt,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});
