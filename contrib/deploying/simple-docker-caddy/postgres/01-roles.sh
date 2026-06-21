#!/bin/bash
# Production role bootstrap for the self-hosted Supabase postgres.
#
# Runs once, during first-init of a fresh pgdata volume
# (/docker-entrypoint-initdb.d). A *.sh script (not *.sql) so it can read
# ${POSTGRES_PASSWORD} from the environment and set every Supabase service role
# to it. Mirrors packages/dev/docker/init.sql, which hardcodes 'postgres' for dev.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  ALTER USER supabase_admin            WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER USER supabase_auth_admin       WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER USER supabase_storage_admin    WITH PASSWORD '${POSTGRES_PASSWORD}';
  ALTER USER authenticator             WITH PASSWORD '${POSTGRES_PASSWORD}';

  GRANT anon, authenticated, service_role TO authenticator;

  CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
EOSQL
