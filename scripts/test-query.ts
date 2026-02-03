/**
 * End-to-end Query Pipeline Test
 *
 * Tests the complete RAG pipeline:
 * 1. Geocode address to jurisdictions
 * 2. Embed query
 * 3. Retrieve relevant chunks from Pinecone
 * 4. Generate answer with Claude
 * 5. Parse and validate response
 *
 * Usage:
 *   npx tsx scripts/test-query.ts "What permits do I need to sell alcohol?" "1000 Main St, Houston, TX 77002"
 *   npx tsx scripts/test-query.ts "What are the food safety requirements?"
 */

import 'dotenv/config';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../apps/convex/convex/_generated/api';

// Validate all required environment variables before proceeding
function validateEnvironment(): void {
  const required = [
    { name: 'CONVEX_URL', hint: 'Set in .env or export CONVEX_URL=https://your-deployment.convex.cloud' },
    { name: 'OPENAI_API_KEY', hint: 'Get from https://platform.openai.com/api-keys' },
    { name: 'PINECONE_API_KEY', hint: 'Get from https://app.pinecone.io/ -> API Keys' },
    { name: 'ANTHROPIC_API_KEY', hint: 'Get from https://console.anthropic.com/settings/keys' }
  ];

  const missing = required.filter(v => !process.env[v.name]);

  if (missing.length > 0) {
    console.error('ERROR: Missing required environment variables:\n');
    missing.forEach(v => {
      console.error(`  ${v.name}`);
      console.error(`    ${v.hint}\n`);
    });
    process.exit(1);
  }

  // Optional: warn about GEOCODIO_API_KEY
  if (!process.env.GEOCODIO_API_KEY) {
    console.warn('WARNING: GEOCODIO_API_KEY not set - address geocoding will fall back to federal-only\n');
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/test-query.ts "<question>" ["<address>"]');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx scripts/test-query.ts "What permits do I need to sell alcohol?" "1000 Main St, Houston, TX 77002"');
    console.log('  npx tsx scripts/test-query.ts "What are the food safety requirements for retail?"');
    process.exit(1);
  }

  // Validate environment before making API calls
  validateEnvironment();

  const question = args[0];
  const address = args[1];

  const convexUrl = process.env.CONVEX_URL!;

  console.log('=== ComplianceIQ Query Pipeline Test ===');
  console.log('');
  console.log(`Question: ${question}`);
  if (address) {
    console.log(`Address: ${address}`);
  }
  console.log('');

  const client = new ConvexHttpClient(convexUrl);

  console.log('Processing query...');
  const startTime = Date.now();

  try {
    const result = await client.action(api.actions.query.processQuery, {
      question,
      address
    });

    const elapsed = Date.now() - startTime;

    console.log('');
    console.log('=== Results ===');
    console.log('');
    console.log(`Jurisdictions: ${result.jurisdictions.join(', ')}`);
    console.log(`Chunks Retrieved: ${result.retrievedChunks.length}`);
    console.log(`Processing Time: ${result.processingTimeMs}ms`);
    console.log(`Confidence: ${result.answer.confidence.level} (${result.answer.confidence.score.toFixed(2)})`);
    console.log(`Confidence Reason: ${result.answer.confidence.reason}`);
    console.log('');

    console.log('=== Answer Summary ===');
    console.log(result.answer.summary);
    console.log('');

    console.log('=== Citations ===');
    result.answer.citations.forEach((c, i) => {
      console.log(`[${c.id}] ${c.citation} (${c.jurisdiction})`);
    });
    console.log('');

    if (result.answer.permits.length > 0) {
      console.log('=== Required Permits ===');
      result.answer.permits.forEach((p, i) => {
        console.log(`${i + 1}. ${p.name}`);
        console.log(`   Agency: ${p.issuingAgency}`);
        console.log(`   Jurisdiction: ${p.jurisdiction}`);
        if (p.url) {
          console.log(`   URL: ${p.url}`);
        }
        console.log(`   Reference: ${p.citation}`);
        console.log('');
      });
    } else {
      console.log('No specific permits identified in response.');
    }

    console.log('=== Full Answer ===');
    console.log('');
    // Print full answer from first assistant message
    console.log(result.answer.sections.map(s =>
      `### ${s.level.charAt(0).toUpperCase() + s.level.slice(1)}\n${s.content}`
    ).join('\n\n'));

    console.log('');
    console.log(`Query ID: ${result.queryId}`);
    console.log(`Total time: ${elapsed}ms`);

  } catch (error) {
    console.error('');
    console.error('ERROR:', error);
    process.exit(1);
  }
}

main();
