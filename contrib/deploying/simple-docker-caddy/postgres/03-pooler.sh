#!/bin/bash
# What Supavisor needs in Postgres, as BYOC sets it up
# (infra/helm/carbon/charts/supabase: db-init/pooler.sql and the _supabase
# Database). Runs once, during first-init of a fresh pgdata volume.
#
#   - _supabase, with the _supavisor schema: Supavisor's own tenant catalogue.
#   - pgbouncer and pgbouncer.get_auth(): Supavisor logs in as pgbouncer and
#     looks up each client's credentials through the function, which only that
#     role may call.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE _supabase OWNER supabase_admin;
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname _supabase <<-EOSQL
  CREATE SCHEMA IF NOT EXISTS _supavisor AUTHORIZATION supabase_admin;
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
do $$
begin
  if not exists (select from pg_roles where rolname = 'pgbouncer') then
    create role pgbouncer login noinherit;
  end if;
end $$;

create schema if not exists pgbouncer;
grant usage on schema pgbouncer to pgbouncer;

create or replace function pgbouncer.get_auth(p_usename text)
returns table(username text, password text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise debug 'PgBouncer auth request: %', p_usename;
  return query
    select rolname::text,
           case when rolvaliduntil < now() then null else rolpassword::text end
      from pg_catalog.pg_authid
     where rolname = p_usename and rolcanlogin;
end;
$$;

revoke all on function pgbouncer.get_auth(text) from public;
grant execute on function pgbouncer.get_auth(text) to pgbouncer;
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  ALTER ROLE pgbouncer WITH PASSWORD '${POSTGRES_PASSWORD}';
EOSQL
