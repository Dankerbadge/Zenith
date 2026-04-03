#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <OPS_AUTOMATION_KEY>"
  exit 1
fi

KEY="$1"
if [[ ${#KEY} -lt 20 ]]; then
  echo "OPS_AUTOMATION_KEY looks too short; refusing to set."
  exit 1
fi

supabase secrets set OPS_AUTOMATION_KEY="$KEY"
supabase functions deploy ops-maintenance --no-verify-jwt

echo "OPS_AUTOMATION_KEY rotated and ops-maintenance redeployed."
