#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WATCH_DIR="$ROOT_DIR/garmin-watch/zenith-garmin-watch"
KEY_DIR="$ROOT_DIR/garmin-watch/.keys"
KEY_PEM="$KEY_DIR/dev_build_key.pem"
KEY_DER="$KEY_DIR/dev_build_key.der"
OUT_DIR="$WATCH_DIR/build"

if [[ -f "$ROOT_DIR/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT_DIR/.env.local"
  set +a
fi

SDK_CFG="$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg"
if [[ ! -f "$SDK_CFG" ]]; then
  echo "[garmin-watch] Missing Connect IQ SDK config: $SDK_CFG" >&2
  exit 1
fi

# current-sdk.cfg may contain an extra trailing path; take the first line that exists as a directory.
SDK_LINE="$(head -n 1 "$SDK_CFG" || true)"
SDK_LINE="${SDK_LINE%%$'\r'}"
# current-sdk.cfg sometimes concatenates two paths using a double-slash separator.
SDK_DIR="${SDK_LINE%%//*}"
SDK_DIR="${SDK_DIR%/}"
[[ -z "$SDK_DIR" ]] && SDK_DIR="$SDK_LINE"
SDK_DIR="${SDK_DIR%/}"

if [[ -z "$SDK_DIR" ]]; then
  echo "[garmin-watch] Could not resolve SDK dir from $SDK_CFG" >&2
  cat "$SDK_CFG" >&2 || true
  exit 1
fi

if [[ ! -d "$SDK_DIR" ]]; then
  echo "[garmin-watch] SDK dir does not exist: $SDK_DIR" >&2
  cat "$SDK_CFG" >&2 || true
  exit 1
fi

MONKEYC="$SDK_DIR/bin/monkeyc"
if [[ ! -x "$MONKEYC" ]]; then
  echo "[garmin-watch] monkeyc not executable at: $MONKEYC" >&2
  exit 1
fi

DEVICE="${1:-}"
mkdir -p "$KEY_DIR" "$OUT_DIR"

MODE="${GARMIN_BUILD_MODE:-sim}" # sim | export

if [[ "$MODE" != "sim" && "$MODE" != "export" ]]; then
  echo "[garmin-watch] Invalid GARMIN_BUILD_MODE=$MODE (expected sim|export)" >&2
  exit 1
fi

if [[ "$MODE" == "sim" ]]; then
  if [[ -z "$DEVICE" ]]; then
    DEVICE="fenix7"
  fi
  # Simulator/dev builds can be signed with any locally generated key.
  if [[ ! -f "$KEY_PEM" ]]; then
    echo "[garmin-watch] Generating local build key (not committed)…"
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$KEY_PEM" >/dev/null 2>&1
  fi

  if [[ ! -f "$KEY_DER" ]]; then
    openssl pkcs8 -topk8 -inform PEM -outform DER -nocrypt -in "$KEY_PEM" -out "$KEY_DER" >/dev/null 2>&1
  fi

  OUT_FILE="$OUT_DIR/ZenithGarmin-${DEVICE}.prg"
  echo "[garmin-watch] Building simulator PRG for device=${DEVICE}"
  "$MONKEYC" \
    -y "$KEY_DER" \
    -d "$DEVICE" \
    -f "$WATCH_DIR/monkey.jungle" \
    -o "$OUT_FILE" >/dev/null
  echo "[garmin-watch] Built: $OUT_FILE"
  exit 0
fi

# Exportable IQ packages require a real Garmin developer key generated from your Connect IQ developer account.
DEV_KEY="${GARMIN_DEVELOPER_KEY_DER:-}"
if [[ -z "$DEV_KEY" || ! -f "$DEV_KEY" ]]; then
  echo "[garmin-watch] GARMIN_DEVELOPER_KEY_DER is required for export builds." >&2
  echo "[garmin-watch] Set GARMIN_DEVELOPER_KEY_DER to your Connect IQ developer key (.der) and rerun with GARMIN_BUILD_MODE=export." >&2
  exit 1
fi

if [[ -n "$DEVICE" ]]; then
  OUT_FILE="$OUT_DIR/ZenithGarmin-${DEVICE}.iq"
  echo "[garmin-watch] Building exportable IQ for device=${DEVICE}"
  "$MONKEYC" \
    -e \
    -y "$DEV_KEY" \
    -d "$DEVICE" \
    -f "$WATCH_DIR/monkey.jungle" \
    -o "$OUT_FILE" >/dev/null
else
  OUT_FILE="$OUT_DIR/ZenithGarmin-UPLOAD.iq"
  echo "[garmin-watch] Building exportable IQ for all manifest devices"
  "$MONKEYC" \
    -e \
    -r \
    -y "$DEV_KEY" \
    -f "$WATCH_DIR/monkey.jungle" \
    -o "$OUT_FILE" >/dev/null
fi

echo "[garmin-watch] Built: $OUT_FILE"
