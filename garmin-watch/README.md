Zenith Garmin Connect IQ Watch App (P0)

This folder contains the Connect IQ watch app source for Garmin P0:
- Watch is the authoritative recorder (ActivityRecording).
- Run: best-effort live metrics + optional reduced route preview export (outdoor runs only).
- Lift: set counter + undo window.

Known limitations
- Crash recovery: Connect IQ cannot reattach to an existing ActivityRecording session after a crash. Recovery starts a new session, so the FIT file may be partial.

Build notes
- The Connect IQ SDK is installed under:
  ~/Library/Application Support/Garmin/ConnectIQ/Sdks/...
- This repo does not commit developer keys. The build script will generate a local key if missing.

Commands
- Build simulator PRG (fenix7 by default):
  npm run -s garmin:build-watch

- Run in the Connect IQ simulator (simulator must be running):
  npm run -s garmin:sim

- Build exportable IQ (requires a real Garmin developer key):
  GARMIN_DEVELOPER_KEY_DER=/path/to/your/developer_key.der npm run -s garmin:export-watch

Notes
- A locally generated key is sufficient for simulator builds.
- Exportable IQ packages require a Connect IQ developer key tied to your Garmin developer account.
