#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <USDA_API_KEY>"
  exit 1
fi

USDA_KEY="$1"

if [[ ${#USDA_KEY} -lt 20 ]]; then
  echo "USDA_API_KEY looks too short; refusing to set."
  exit 1
fi

supabase secrets set USDA_API_KEY="$USDA_KEY"
supabase functions deploy food-search --no-verify-jwt

echo "USDA_API_KEY rotated and food-search redeployed."
