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

// =============================================================================
// Texas County Coverage Functions
// =============================================================================

/**
 * Target Texas counties for MVP
 * Coverage status tracked per county
 * Note: Use countyFips field (schema field name) not fipsCode
 */
const TARGET_COUNTIES = [
  { name: 'Harris', countyFips: '48201' },
  { name: 'Dallas', countyFips: '48113' },
  { name: 'Tarrant', countyFips: '48439' },
  { name: 'Bexar', countyFips: '48029' },
  { name: 'Travis', countyFips: '48453' },
  { name: 'Collin', countyFips: '48085' },
  { name: 'Denton', countyFips: '48121' },
  { name: 'Fort Bend', countyFips: '48157' },
  { name: 'Williamson', countyFips: '48491' },
  { name: 'El Paso', countyFips: '48141' },
];

/**
 * List all Texas county jurisdictions with coverage status
 *
 * Returns all 10 target counties with their current processing status,
 * whether or not they exist in the database yet.
 */
export const listTexasCounties = query({
  args: {},
  handler: async (ctx) => {
    // Get all county jurisdictions from database
    // Use stateCode (schema field) not state
    const countyJurisdictions = await ctx.db
      .query('jurisdictions')
      .filter((q) =>
        q.and(
          q.eq(q.field('type'), 'county'),
          q.eq(q.field('stateCode'), 'TX')
        )
      )
      .collect();

    // Map to include coverage status
    return TARGET_COUNTIES.map((county) => {
      const jurisdiction = countyJurisdictions.find(
        (j) => j.countyFips === county.countyFips
      );

      return {
        name: county.name,
        fipsCode: county.countyFips, // Return as fipsCode for API consistency
        jurisdictionId: `tx-county-${county.countyFips}`,
        covered: !!jurisdiction,
        lastScrapedAt: jurisdiction?.lastScrapedAt,
        vectorCount: jurisdiction?.vectorCount || 0,
        status: jurisdiction?.status || 'pending',
        error: jurisdiction?.error,
      };
    });
  },
});

/**
 * Update county jurisdiction status after pipeline processing
 *
 * Called by the county pipeline to update coverage tracking after
 * processing a county. Creates the jurisdiction record if it doesn't exist.
 */
export const updateCountyStatus = mutation({
  args: {
    fipsCode: v.string(), // Accept fipsCode from API, map to countyFips
    status: v.union(
      v.literal('active'),
      v.literal('error'),
      v.literal('pending')
    ),
    lastScrapedAt: v.number(),
    vectorCount: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { fipsCode, status, lastScrapedAt, vectorCount, error } = args;

    // Find existing jurisdiction record using countyFips field
    const existing = await ctx.db
      .query('jurisdictions')
      .withIndex('by_county_fips', (q) => q.eq('countyFips', fipsCode))
      .filter((q) => q.eq(q.field('type'), 'county'))
      .first();

    const county = TARGET_COUNTIES.find((c) => c.countyFips === fipsCode);
    const jurisdictionId = `tx-county-${fipsCode}`;

    if (existing) {
      // Update existing record
      await ctx.db.patch(existing._id, {
        status,
        lastScrapedAt,
        vectorCount: vectorCount || existing.vectorCount,
        error,
        updatedAt: Date.now(),
      });
    } else {
      // Create new record using schema field names
      await ctx.db.insert('jurisdictions', {
        type: 'county',
        stateCode: 'TX', // Schema uses stateCode not state
        name: county?.name ? `${county.name} County` : `County ${fipsCode}`,
        countyFips: fipsCode, // Schema uses countyFips not fipsCode
        isActive: true,
        status,
        lastScrapedAt,
        vectorCount: vectorCount || 0,
        error,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    return { success: true, jurisdictionId };
  },
});

/**
 * Get county jurisdiction by FIPS code
 *
 * Returns the county jurisdiction record if it exists, along with
 * the county name from the target list.
 */
export const getCountyByFips = query({
  args: {
    fipsCode: v.string(),
  },
  handler: async (ctx, args) => {
    // Use countyFips index for efficient lookup
    const jurisdiction = await ctx.db
      .query('jurisdictions')
      .withIndex('by_county_fips', (q) => q.eq('countyFips', args.fipsCode))
      .filter((q) => q.eq(q.field('type'), 'county'))
      .first();

    const county = TARGET_COUNTIES.find((c) => c.countyFips === args.fipsCode);

    return {
      name: county?.name || `County ${args.fipsCode}`,
      fipsCode: args.fipsCode,
      jurisdictionId: `tx-county-${args.fipsCode}`,
      covered: !!jurisdiction,
      status: jurisdiction?.status || 'pending',
      lastScrapedAt: jurisdiction?.lastScrapedAt,
      vectorCount: jurisdiction?.vectorCount || 0,
      error: jurisdiction?.error,
    };
  },
});

/**
 * Get coverage summary for Texas counties
 *
 * Returns aggregate statistics about county coverage including
 * counts by status and total vectors indexed.
 */
export const getTexasCountyCoverage = query({
  args: {},
  handler: async (ctx) => {
    // Use stateCode field (schema field name)
    const counties = await ctx.db
      .query('jurisdictions')
      .filter((q) =>
        q.and(
          q.eq(q.field('type'), 'county'),
          q.eq(q.field('stateCode'), 'TX')
        )
      )
      .collect();

    const activeCount = counties.filter((c) => c.status === 'active').length;
    const errorCount = counties.filter((c) => c.status === 'error').length;
    const pendingCount = TARGET_COUNTIES.length - counties.length;
    const totalVectors = counties.reduce(
      (sum, c) => sum + (c.vectorCount || 0),
      0
    );

    return {
      targetCounties: TARGET_COUNTIES.length,
      coveredCounties: counties.length,
      activeCounties: activeCount,
      errorCounties: errorCount,
      pendingCounties: pendingCount,
      totalVectors,
      coveragePercent: Math.round((activeCount / TARGET_COUNTIES.length) * 100),
    };
  },
});
