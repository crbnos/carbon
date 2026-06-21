#!/bin/bash
# Production Postgres tuning for the self-hosted Supabase database.
#
# Runs once on first-init of a fresh pgdata volume. Settings are written with
# ALTER SYSTEM (-> postgresql.auto.conf) and take effect when the entrypoint
# restarts Postgres at the end of initialization. Sizing knobs come from the
# CARBON_PG_* env (set in stack.yml from PG_* in .env); tune them to your VPS.
#
# Guidance (Supabase Postgres best practices):
#   - max_connections: keep modest (100-200). The app pools client-side and a
#     connection costs 1-3 MB. Raising this blindly exhausts memory.
#   - shared_buffers       ~= 25% of RAM
#   - effective_cache_size ~= 50-75% of RAM (a planner hint, not an allocation)
#   - work_mem * max_connections should stay under ~25% of RAM
#   - pg_stat_statements: top-N slow/frequent query visibility (preloaded via the
#     shared_preload_libraries server flag in stack.yml's postgres command).
set -euo pipefail

MAX_CONNECTIONS="${CARBON_PG_MAX_CONNECTIONS:-100}"
SHARED_BUFFERS="${CARBON_PG_SHARED_BUFFERS:-512MB}"
EFFECTIVE_CACHE_SIZE="${CARBON_PG_EFFECTIVE_CACHE_SIZE:-1536MB}"
WORK_MEM="${CARBON_PG_WORK_MEM:-8MB}"
MAINTENANCE_WORK_MEM="${CARBON_PG_MAINTENANCE_WORK_MEM:-128MB}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  ALTER SYSTEM SET max_connections          = '${MAX_CONNECTIONS}';
  ALTER SYSTEM SET shared_buffers           = '${SHARED_BUFFERS}';
  ALTER SYSTEM SET effective_cache_size     = '${EFFECTIVE_CACHE_SIZE}';
  ALTER SYSTEM SET work_mem                 = '${WORK_MEM}';
  ALTER SYSTEM SET maintenance_work_mem     = '${MAINTENANCE_WORK_MEM}';

  -- SSD-friendly planner defaults.
  ALTER SYSTEM SET random_page_cost         = '1.1';
  ALTER SYSTEM SET effective_io_concurrency = '200';

  -- Query visibility. pg_stat_statements is preloaded via the postgres command
  -- flag (shared_preload_libraries) in stack.yml.
  ALTER SYSTEM SET track_io_timing          = 'on';
  ALTER SYSTEM SET pg_stat_statements.track = 'all';
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EOSQL
