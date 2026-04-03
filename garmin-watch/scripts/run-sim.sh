#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WATCH_DIR="$ROOT_DIR/garmin-watch/zenith-garmin-watch"
OUT_DIR="$WATCH_DIR/build"

SDK_CFG="$HOME/Library/Application Support/Garmin/ConnectIQ/current-sdk.cfg"
if [[ ! -f "$SDK_CFG" ]]; then
  echo "[garmin-watch] Missing Connect IQ SDK config: $SDK_CFG" >&2
  exit 1
fi

SDK_LINE="$(head -n 1 "$SDK_CFG" | tr -d '\r')"
SDK_DIR="${SDK_LINE%%//*}"
SDK_DIR="${SDK_DIR%/}"
[[ -z "$SDK_DIR" ]] && SDK_DIR="$SDK_LINE"
SDK_DIR="${SDK_DIR%/}"

MONKEYDO="$SDK_DIR/bin/monkeydo"
if [[ ! -x "$MONKEYDO" ]]; then
  echo "[garmin-watch] monkeydo not executable at: $MONKEYDO" >&2
  exit 1
fi

DEVICE="${1:-fenix7}"
PRG="$OUT_DIR/ZenithGarmin-${DEVICE}.prg"
if [[ ! -f "$PRG" ]]; then
  echo "[garmin-watch] Missing PRG: $PRG" >&2
  echo "[garmin-watch] Run: npm run -s garmin:build-watch" >&2
  exit 1
fi

echo "[garmin-watch] Running on simulator device=${DEVICE}"
echo "[garmin-watch] Note: The Connect IQ simulator must already be running."
"$MONKEYDO" "$PRG" "$DEVICE"

