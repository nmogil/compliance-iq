#!/usr/bin/env tsx

import { Pinecone } from '@pinecone-database/pinecone';

const INDEX_NAME = 'compliance-embeddings';
const DIMENSION = 3072; // OpenAI text-embedding-3-large
const METRIC = 'cosine';
const CLOUD = 'aws';
const REGION = 'us-east-1';

async function main() {
  const apiKey = process.env.PINECONE_API_KEY;

  if (!apiKey) {
    console.error('Error: PINECONE_API_KEY environment variable is required');
    console.error('Get your API key from: https://www.pinecone.io/');
    process.exit(1);
  }

  console.log('Initializing Pinecone client...');
  const pc = new Pinecone({ apiKey });

  console.log(`Checking if index "${INDEX_NAME}" exists...`);
  const existingIndexes = await pc.listIndexes();
  const indexExists = existingIndexes.indexes?.some(
    (idx) => idx.name === INDEX_NAME
  );

  if (indexExists) {
    console.log(`✓ Index "${INDEX_NAME}" already exists`);
    const indexDescription = await pc.describeIndex(INDEX_NAME);
    console.log('\nIndex configuration:');
    console.log(`  Name: ${indexDescription.name}`);
    console.log(`  Dimension: ${indexDescription.dimension}`);
    console.log(`  Metric: ${indexDescription.metric}`);
    console.log(
      `  Status: ${indexDescription.status?.ready ? 'Ready' : 'Not ready'}`
    );
    console.log(
      `  Spec: ${indexDescription.spec?.serverless ? 'serverless' : 'pod-based'}`
    );
    if (indexDescription.spec?.serverless) {
      console.log(`  Cloud: ${indexDescription.spec.serverless.cloud}`);
      console.log(`  Region: ${indexDescription.spec.serverless.region}`);
    }
  } else {
    console.log(`Creating index "${INDEX_NAME}"...`);
    await pc.createIndex({
      name: INDEX_NAME,
      dimension: DIMENSION,
      metric: METRIC,
      spec: {
        serverless: {
          cloud: CLOUD,
          region: REGION,
        },
      },
    });

    console.log('Waiting for index to be ready...');
    let ready = false;
    while (!ready) {
      const description = await pc.describeIndex(INDEX_NAME);
      ready = description.status?.ready ?? false;
      if (!ready) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        process.stdout.write('.');
      }
    }
    console.log('\n');

    console.log(`✓ Index "${INDEX_NAME}" created successfully`);
    const indexDescription = await pc.describeIndex(INDEX_NAME);
    console.log('\nIndex configuration:');
    console.log(`  Name: ${indexDescription.name}`);
    console.log(`  Dimension: ${indexDescription.dimension}`);
    console.log(`  Metric: ${indexDescription.metric}`);
    console.log(
      `  Status: ${indexDescription.status?.ready ? 'Ready' : 'Not ready'}`
    );
    console.log(
      `  Spec: ${indexDescription.spec?.serverless ? 'serverless' : 'pod-based'}`
    );
    if (indexDescription.spec?.serverless) {
      console.log(`  Cloud: ${indexDescription.spec.serverless.cloud}`);
      console.log(`  Region: ${indexDescription.spec.serverless.region}`);
    }
  }

  console.log('\n✓ Pinecone setup complete');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
