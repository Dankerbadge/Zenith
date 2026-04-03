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

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="$ROOT/backups/supabase"
OUT_FILE="$OUT_DIR/zenith-public-${STAMP}.sql"

mkdir -p "$OUT_DIR"

echo "Creating Supabase logical backup -> $OUT_FILE"
BACKUP_OK=0

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if supabase db dump --linked --schema public > "$OUT_FILE"; then
    BACKUP_OK=1
  fi
fi

if [[ "$BACKUP_OK" -eq 0 ]]; then
  DB_URL="${SUPABASE_DB_URL:-${SUPABASE_DB_URI:-}}"
  DB_PASSWORD="${SUPABASE_DB_PASSWORD:-${PGPASSWORD:-}}"
  PG_DUMP_BIN="$(command -v pg_dump || true)"
  if [[ -z "$PG_DUMP_BIN" ]] && [[ -x /opt/homebrew/opt/libpq/bin/pg_dump ]]; then
    PG_DUMP_BIN="/opt/homebrew/opt/libpq/bin/pg_dump"
  fi
  if [[ -z "$PG_DUMP_BIN" ]] && [[ -x /usr/local/opt/libpq/bin/pg_dump ]]; then
    PG_DUMP_BIN="/usr/local/opt/libpq/bin/pg_dump"
  fi
  if [[ -n "$DB_URL" ]] && [[ -n "$PG_DUMP_BIN" ]]; then
    if [[ -n "$DB_PASSWORD" ]]; then
      PGPASSWORD="$DB_PASSWORD" "$PG_DUMP_BIN" "$DB_URL" -n public > "$OUT_FILE"
      BACKUP_OK=1
    else
      echo "SUPABASE_DB_URL is set but DB password is missing (set SUPABASE_DB_PASSWORD or PGPASSWORD)." >&2
    fi
  fi
fi

if [[ "$BACKUP_OK" -eq 0 ]]; then
  echo "Backup failed: Docker is unavailable and no pg_dump DB credentials were provided." >&2
  echo "Set SUPABASE_DB_URL + SUPABASE_DB_PASSWORD in .env.local, then rerun." >&2
  exit 1
fi

echo "Recording logical_backup heartbeat"
"$ROOT/scripts/run-backend-maintenance.sh" logical_backup > /dev/null

echo "Backup complete and heartbeat recorded."
