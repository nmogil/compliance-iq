#!/bin/bash
# ===========================================
# Set Cloudflare Worker Secrets
# ===========================================
# Run this after filling in your .env file:
#   ./scripts/setup-worker-secrets.sh

set -e

# Load .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "Error: .env file not found"
  exit 1
fi

cd apps/workers

echo "Setting Cloudflare Worker secrets..."
echo "(You may be prompted to log in to Cloudflare)"
echo ""

if [ -n "$OPENAI_API_KEY" ]; then
  echo "$OPENAI_API_KEY" | npx wrangler secret put OPENAI_API_KEY
  echo "✓ OPENAI_API_KEY set"
else
  echo "⚠ OPENAI_API_KEY is empty, skipping"
fi

if [ -n "$PINECONE_API_KEY" ]; then
  echo "$PINECONE_API_KEY" | npx wrangler secret put PINECONE_API_KEY
  echo "✓ PINECONE_API_KEY set"
else
  echo "⚠ PINECONE_API_KEY is empty, skipping"
fi

if [ -n "$CONVEX_URL" ]; then
  echo "$CONVEX_URL" | npx wrangler secret put CONVEX_URL
  echo "✓ CONVEX_URL set"
else
  echo "⚠ CONVEX_URL is empty, skipping"
fi

if [ -n "$FIRECRAWL_API_KEY" ]; then
  echo "$FIRECRAWL_API_KEY" | npx wrangler secret put FIRECRAWL_API_KEY
  echo "✓ FIRECRAWL_API_KEY set"
else
  echo "⚠ FIRECRAWL_API_KEY is empty, skipping"
fi

echo ""
echo "✓ Cloudflare Worker secrets configured"
echo ""
echo "Deploy workers with: cd apps/workers && pnpm deploy"
