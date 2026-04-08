#!/bin/sh
# Entry point script for BCProxyAI Docker container

echo "Running database migration..."
npx tsx scripts/migrate.ts || echo "Migration skipped or completed"

echo "Starting BCProxyAI..."
exec node server.js
