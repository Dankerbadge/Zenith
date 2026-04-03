# Backend Ops P0 Automation

## What Is Automated
- Food-search cache and prefix cache cleanup (scheduled in DB cron).
- Food-search SLO evaluation and alert insertion (scheduled in DB cron).
- Food-search per-user rate limits (minute + daily) at request time.
- Protected backend-op table RLS regression verification.
- USDA secret rotation + function redeploy automation.
- Backup heartbeat stale detection (alerts if `logical_backup` heartbeat is older than 8 days).

## Required Secrets
- `USDA_API_KEY`
- `OPS_AUTOMATION_KEY`

## Rotate USDA Key
```bash
cd /Users/dankerbadge/Desktop/Zenith
./scripts/rotate-food-search-secrets.sh "<NEW_USDA_API_KEY>"
```

## Run Maintenance Manually
```bash
cd /Users/dankerbadge/Desktop/Zenith
./scripts/run-backend-maintenance.sh
```

## Create Backup + Record Heartbeat
```bash
cd /Users/dankerbadge/Desktop/Zenith
./scripts/backup-and-heartbeat.sh
```

If Docker is unavailable, set these in `.env.local` for `pg_dump` fallback:
- `SUPABASE_DB_URL` (Postgres URI)
- `SUPABASE_DB_PASSWORD` (DB password)

## Verify Runtime + Ops Automation
```bash
cd /Users/dankerbadge/Desktop/Zenith
npm run -s verify:supabase-runtime
npm run -s verify:backend-ops-automation
```
