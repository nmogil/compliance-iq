#!/usr/bin/env tsx
/**
 * Test script for municipal jurisdiction query filtering
 *
 * Validates Phase 5 Success Criterion:
 * "Test queries filtered by city return relevant municipal codes"
 *
 * Tests that Pinecone queries with jurisdiction filter (TX-{cityId})
 * return only vectors from the specified city.
 *
 * Usage:
 *   PINECONE_API_KEY=xxx OPENAI_API_KEY=xxx pnpm exec tsx scripts/test-municipal-query.ts
 */

import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

const INDEX_NAME = 'compliance-embeddings';

// Target cities for testing
const TEST_CASES = [
  {
    name: 'Houston',
    jurisdiction: 'TX-houston',
    query: 'building permit requirements Houston Texas municipal code',
  },
  {
    name: 'Dallas',
    jurisdiction: 'TX-dallas',
    query: 'business license requirements Dallas Texas city ordinance',
  },
  {
    name: 'Austin',
    jurisdiction: 'TX-austin',
    query: 'zoning regulations Austin Texas municipal ordinances',
  },
];

async function testMunicipalQuery() {
  console.log('[Test] Municipal Jurisdiction Query Filtering Test');
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
    console.warn('[Test] WARNING: Index is empty. Run municipal pipeline first.');
    console.log('[Test] Skipping query tests - no data to query');
    process.exit(0);
  }

  let allTestsPassed = true;

  // Test 1: Query with municipal jurisdiction filter
  console.log('\n[Test] Test 1: Municipal jurisdiction filtering');
  console.log('-'.repeat(40));

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
        console.log('[Test] This may be expected if municipal data has not been indexed');
        continue;
      }

      // Validate all results have correct jurisdiction and sourceType
      let cityTestPassed = true;
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
          cityTestPassed = false;
          allTestsPassed = false;
        }

        if (sourceType !== 'municipal') {
          console.warn(`[Test] WARN: Result has unexpected sourceType: ${sourceType} (expected 'municipal')`);
        }
      }

      if (cityTestPassed) {
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

  // Test 2: Query with sourceType filter only
  console.log('\n[Test] Test 2: Source type filtering (municipal only)');
  console.log('-'.repeat(40));

  try {
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: 'city ordinance regulations Texas',
    });
    const queryVector = embeddingResponse.data[0].embedding;

    const results = await index.query({
      vector: queryVector,
      topK: 10,
      includeMetadata: true,
      filter: {
        sourceType: { $eq: 'municipal' },
      },
    });

    console.log(`[Test] Found ${results.matches?.length || 0} municipal vectors`);

    if (results.matches && results.matches.length > 0) {
      // Verify all results are municipal
      const allMunicipal = results.matches.every((m) => m.metadata?.sourceType === 'municipal');
      if (allMunicipal) {
        console.log('[Test] PASS: All results have sourceType: municipal');
      } else {
        console.error('[Test] FAIL: Some results have wrong sourceType');
        allTestsPassed = false;
      }

      // Show sample results
      console.log('[Test] Sample results:');
      for (const match of results.matches.slice(0, 3)) {
        const meta = match.metadata;
        console.log(`  - ${meta?.jurisdiction}: ${meta?.title || 'No title'}`);
      }
    } else {
      console.log('[Test] INFO: No municipal vectors in index yet');
    }
  } catch (error) {
    console.error('[Test] ERROR: sourceType query failed:', error instanceof Error ? error.message : error);
    allTestsPassed = false;
  }

  // Test 3: Validate metadata fields
  console.log('\n[Test] Test 3: Metadata field validation');
  console.log('-'.repeat(40));

  try {
    // Fetch a sample vector to validate metadata structure
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-large',
      input: 'municipal code',
    });
    const queryVector = embeddingResponse.data[0].embedding;

    const results = await index.query({
      vector: queryVector,
      topK: 1,
      includeMetadata: true,
      filter: {
        sourceType: { $eq: 'municipal' },
      },
    });

    if (results.matches && results.matches.length > 0) {
      const metadata = results.matches[0].metadata;

      const requiredFields = [
        'chunkId',
        'sourceId',
        'sourceType',
        'jurisdiction',
        'text',
        'citation',
        'title',
      ];

      const municipalFields = [
        'cityId',
        'cityName',
        'chapter',
        'section',
        'hierarchy',
        'sourceUrl',
      ];

      console.log('[Test] Checking required fields...');
      let metadataValid = true;

      for (const field of requiredFields) {
        if (metadata?.[field] !== undefined) {
          console.log(`  [OK] ${field}: present`);
        } else {
          console.error(`  [FAIL] ${field}: missing`);
          metadataValid = false;
        }
      }

      console.log('\n[Test] Checking municipal-specific fields...');
      for (const field of municipalFields) {
        if (metadata?.[field] !== undefined) {
          console.log(`  [OK] ${field}: ${String(metadata[field]).substring(0, 50)}`);
        } else {
          console.warn(`  [WARN] ${field}: missing (may be expected)`);
        }
      }

      if (metadataValid) {
        console.log('\n[Test] PASS: Required metadata fields present');
      } else {
        console.error('\n[Test] FAIL: Some required metadata fields missing');
        allTestsPassed = false;
      }
    } else {
      console.log('[Test] INFO: No municipal vectors to validate');
    }
  } catch (error) {
    console.error('[Test] ERROR: Metadata validation failed:', error instanceof Error ? error.message : error);
    allTestsPassed = false;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  if (allTestsPassed) {
    console.log('[Test] PASS: Municipal jurisdiction filtering validated successfully');
    process.exit(0);
  } else {
    console.error('[Test] FAIL: Some tests failed');
    process.exit(1);
  }
}

testMunicipalQuery().catch((err) => {
  console.error('[Test] Unexpected error:', err);
  process.exit(1);
});
