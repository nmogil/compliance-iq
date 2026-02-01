import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Convex Schema for ComplianceIQ
 *
 * Defines the database structure for:
 * - Jurisdictions: Federal, state, county, city regulatory bodies
 * - Sources: Regulatory data sources within jurisdictions
 * - Conversations: User chat sessions with AI
 * - Messages: Individual messages within conversations
 */

export default defineSchema({
  // Jurisdictions table: Tracks regulatory bodies at all levels
  jurisdictions: defineTable({
    name: v.string(), // e.g., "Federal", "Texas", "Harris County", "Houston"
    type: v.union(
      v.literal('federal'),
      v.literal('state'),
      v.literal('county'),
      v.literal('city')
    ),
    // State-specific fields (null for federal)
    stateCode: v.optional(v.string()), // e.g., "TX"
    // County-specific fields (null for federal/state)
    countyFips: v.optional(v.string()), // e.g., "48201" for Harris County
    // City-specific fields (null for federal/state/county)
    cityName: v.optional(v.string()), // e.g., "Houston"
    isActive: v.boolean(), // Whether we're actively tracking this jurisdiction
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_type', ['type'])
    .index('by_state', ['stateCode'])
    .index('by_active', ['isActive']),

  // Sources table: Regulatory data sources within jurisdictions
  sources: defineTable({
    jurisdictionId: v.id('jurisdictions'),
    name: v.string(), // e.g., "Code of Federal Regulations", "Texas Administrative Code"
    url: v.string(), // Base URL for the source
    sourceType: v.union(
      v.literal('statutes'), // Legislative code
      v.literal('regulations'), // Administrative/regulatory code
      v.literal('ordinances'), // City/county ordinances
      v.literal('other') // Court rules, guidance, etc.
    ),
    status: v.union(
      v.literal('pending'), // Not yet scraped
      v.literal('active'), // Currently being scraped/updated
      v.literal('complete'), // Fully scraped and indexed
      v.literal('error') // Last scrape failed
    ),
    lastScrapedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_jurisdiction', ['jurisdictionId'])
    .index('by_status', ['status'])
    .index('by_type', ['sourceType']),

  // Conversations table: User chat sessions
  conversations: defineTable({
    userId: v.string(), // User identifier (from auth)
    title: v.optional(v.string()), // Auto-generated from first message
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  // Messages table: Individual messages in conversations
  messages: defineTable({
    conversationId: v.id('conversations'),
    role: v.union(
      v.literal('user'), // User question
      v.literal('assistant'), // AI response
      v.literal('system') // System messages
    ),
    content: v.string(), // Message text
    status: v.union(
      v.literal('pending'), // Being generated
      v.literal('complete'), // Fully generated
      v.literal('error') // Generation failed
    ),
    // Citations: Array of source references
    citations: v.optional(
      v.array(
        v.object({
          sourceId: v.id('sources'),
          sectionNumber: v.string(), // e.g., "21 CFR 117.3"
          title: v.string(), // Section title
          url: v.string(), // Direct link to section
          relevanceScore: v.optional(v.number()), // From vector search
        })
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_conversation', ['conversationId'])
    .index('by_status', ['status'])
    .index('by_created', ['createdAt']),
});
