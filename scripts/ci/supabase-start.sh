#!/usr/bin/env bash
# Start local Supabase for CI without the services the checks do not use. Image pulls from the public registry are
# sometimes refused ("Rate exceeded"): try again, up to three times, after stopping whatever half started.
set -uo pipefail

for attempt in 1 2 3; do
  if pnpm supabase:start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta; then
    exit 0
  fi
  echo "::warning::supabase start failed (attempt ${attempt} of 3)"
  pnpm exec supabase stop --no-backup || true
  sleep $((attempt * 20))
done
echo "::error::supabase start failed three times"
exit 1
