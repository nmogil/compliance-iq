#!/bin/bash
# ===========================================
# Set Convex Environment Variables
# ===========================================
# Run this after filling in your .env file:
#   ./scripts/setup-convex-env.sh

set -e

# Load .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "Error: .env file not found"
  exit 1
fi

cd apps/convex

echo "Setting Convex environment variables..."

if [ -n "$OPENAI_API_KEY" ]; then
  npx convex env set OPENAI_API_KEY "$OPENAI_API_KEY"
  echo "✓ OPENAI_API_KEY set"
else
  echo "⚠ OPENAI_API_KEY is empty, skipping"
fi

if [ -n "$PINECONE_API_KEY" ]; then
  npx convex env set PINECONE_API_KEY "$PINECONE_API_KEY"
  echo "✓ PINECONE_API_KEY set"
else
  echo "⚠ PINECONE_API_KEY is empty, skipping"
fi

if [ -n "$ANTHROPIC_API_KEY" ]; then
  npx convex env set ANTHROPIC_API_KEY "$ANTHROPIC_API_KEY"
  echo "✓ ANTHROPIC_API_KEY set"
else
  echo "⚠ ANTHROPIC_API_KEY is empty, skipping"
fi

if [ -n "$GEOCODIO_API_KEY" ]; then
  npx convex env set GEOCODIO_API_KEY "$GEOCODIO_API_KEY"
  echo "✓ GEOCODIO_API_KEY set"
else
  echo "⚠ GEOCODIO_API_KEY is empty, skipping (optional)"
fi

echo ""
echo "✓ Convex environment variables configured"
echo ""
echo "Verify with: cd apps/convex && npx convex env list"
