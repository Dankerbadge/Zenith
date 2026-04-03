#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL:-}"
OPS_KEY="${OPS_AUTOMATION_KEY:-}"

if [[ -z "$SUPABASE_URL" ]]; then
  echo "Missing EXPO_PUBLIC_SUPABASE_URL (.env.local or env)"
  exit 1
fi
if [[ -z "$OPS_KEY" ]]; then
  echo "Missing OPS_AUTOMATION_KEY (.env.local or env)"
  exit 1
fi

PAYLOAD='{}'
if [[ $# -ge 1 ]]; then
  COMPONENT="$1"
  PAYLOAD="{\"heartbeatComponent\":\"${COMPONENT}\",\"heartbeatMeta\":{\"source\":\"run-backend-maintenance.sh\"}}"
fi

curl -fsS -X POST "${SUPABASE_URL}/functions/v1/ops-maintenance" \
  -H "content-type: application/json" \
  -H "x-ops-key: ${OPS_KEY}" \
  -d "$PAYLOAD"

echo

echo "Backend maintenance executed."
