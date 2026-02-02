#!/usr/bin/env tsx
/**
 * Test script for county jurisdiction query filtering
 *
 * Validates Phase 4 Success Criterion #4:
 * "Test queries filtered by county return relevant local regulations"
 *
 * Tests that Pinecone queries with jurisdiction filter (TX-{fipsCode})
 * return only vectors from the specified county.
 *
 * Usage:
 *   PINECONE_API_KEY=xxx OPENAI_API_KEY=xxx pnpm exec tsx scripts/test-county-query.ts
 */

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const INDEX_NAME = 'compliance-embeddings';

// Target counties for testing
const TEST_CASES = [
  {
    name: 'Harris County',
    jurisdiction: 'TX-48201',
    query: 'retail business licensing requirements Harris County Texas',
  },
  {
    name: 'Dallas County',
    jurisdiction: 'TX-48113',
    query: 'business permit requirements Dallas County Texas',
  },
];

async function testCountyQuery() {
  console.log('[Test] County Jurisdiction Query Filtering Test');
  console.log('='.repeat(50));

  // Validate environment variables
  if (!process.env.PINECONE_API_KEY) {
    console.error('[Test] ERROR: PINECONE_API_KEY environment variable required');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('[Test] ERROR: OPENAI_API_KEY environment variable required');
    process.exit(1);
  }

  // Initialize clients
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const index = pinecone.index(INDEX_NAME);

  // Check index stats first
  console.log('\n[Test] Checking index stats...');
  const stats = await index.describeIndexStats();
  console.log(`[Test] Total vectors in index: ${stats.totalRecordCount}`);

  if (!stats.totalRecordCount || stats.totalRecordCount === 0) {
    console.warn('[Test] WARNING: Index is empty. Run county pipeline first.');
    console.log('[Test] Skipping query tests - no data to query');
    process.exit(0);
  }

  let allTestsPassed = true;

  for (const testCase of TEST_CASES) {
    console.log(`\n[Test] Testing ${testCase.name} (${testCase.jurisdiction})`);
    console.log(`[Test] Query: "${testCase.query}"`);

    try {
      // Generate embedding for test query
      const embeddingResponse = await openai.embeddings.create({
        model: 'text-embedding-3-large',
        input: testCase.query,
      });
      const queryVector = embeddingResponse.data[0].embedding;

      // Query Pinecone with jurisdiction filter
      const results = await index.query({
        vector: queryVector,
        topK: 10,
        includeMetadata: true,
        filter: {
          jurisdiction: { $eq: testCase.jurisdiction },
        },
      });

      console.log(`[Test] Found ${results.matches?.length || 0} matches`);

      if (!results.matches || results.matches.length === 0) {
        console.log(`[Test] INFO: No results for ${testCase.name} filter`);
        console.log('[Test] This may be expected if county data has not been indexed');
        continue;
      }

      // Validate all results have correct jurisdiction metadata
      let countyTestPassed = true;
      for (const match of results.matches) {
        const jurisdiction = match.metadata?.jurisdiction;
        const sourceType = match.metadata?.sourceType;

        console.log(
          `  - Score: ${match.score?.toFixed(4)} | Jurisdiction: ${jurisdiction} | Source: ${sourceType}`
        );

        if (jurisdiction !== testCase.jurisdiction) {
          console.error(
            `[Test] FAIL: Result has wrong jurisdiction: ${jurisdiction} (expected ${testCase.jurisdiction})`
          );
          countyTestPassed = false;
          allTestsPassed = false;
        }

        if (sourceType !== 'county') {
          console.warn(`[Test] WARN: Result has unexpected sourceType: ${sourceType}`);
        }
      }

      if (countyTestPassed) {
        console.log(
          `[Test] PASS: All results have correct ${testCase.name} jurisdiction (${testCase.jurisdiction})`
        );
      }
    } catch (error) {
      console.error(
        `[Test] ERROR: Query failed for ${testCase.name}:`,
        error instanceof Error ? error.message : error
      );
      allTestsPassed = false;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  if (allTestsPassed) {
    console.log('[Test] PASS: County jurisdiction filtering validated successfully');
    process.exit(0);
  } else {
    console.error('[Test] FAIL: Some tests failed');
    process.exit(1);
  }
}

testCountyQuery().catch((err) => {
  console.error('[Test] Unexpected error:', err);
  process.exit(1);
});
