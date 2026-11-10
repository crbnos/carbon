-- SPDX-License-Identifier: AGPL-3.0-only
-- Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
-- including ports, remain AGPLv3; serving them over a network requires releasing their source.

-- Applied by crbn to every wt_ database on every `crbn up` (idempotent).
--
-- The shared cluster has one pg_net worker and one pg_cron scheduler, and both
-- serve only the `postgres` database. These triggers hand a worktree
-- database's HTTP requests and cron jobs to `postgres` when the transaction
-- commits, so a rolled-back transaction sends and schedules nothing.
--
-- supabase_admin owns the functions: the container's unix socket trusts it,
-- so dblink needs no password.

create schema if not exists crbn;
revoke all on schema crbn from public;
create extension if not exists dblink schema crbn;

-- Runs sql in `postgres`. Its last statement returns one text column:
-- dblink_exec refuses a statement that returns rows.
create or replace function crbn.remote(sql text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform from crbn.dblink('dbname=postgres user=supabase_admin', sql) as t(r text);
end $$;

-- Sends every queued row (this transaction's, and any an earlier failure
-- left) to `postgres` in one dblink connection. The trigger fires once per
-- queued row at commit: its first call takes them all, the later calls find
-- nothing. On a failure the exception block undoes the delete, so the rows
-- wait for the next commit, or for `crbn up`, which calls this too.
--
-- The request leaves during commit processing, before deferred constraints
-- that come after it in the queue: if one of those fails, the transaction
-- rolls back but the request is sent. Postgres has no hook that runs after a
-- commit, and production's pg_net sends only then.
create or replace function crbn.flush_http() returns void
language plpgsql security definer set search_path = '' as $$
declare
  rows text;
begin
  with taken as (
    delete from net.http_request_queue
     where id in (select id from net.http_request_queue for update skip locked)
    returning method, url, headers, body, timeout_milliseconds
  )
  select string_agg(format('(%L, %L, %L::jsonb, %L::bytea, %s)',
           method, url, headers, body, coalesce(timeout_milliseconds, 5000)), ', ')
    into rows from taken;
  if rows is null then return; end if;
  perform crbn.remote(
    'insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds) values '
    || rows || '; select net.wake()::text');
exception when others then
  raise warning 'crbn: pg_net requests not forwarded, kept for the next commit: %', sqlerrm;
end $$;

create or replace function crbn.forward_http() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform crbn.flush_http();
  return null;
end $$;

drop trigger if exists crbn_forward_http on net.http_request_queue;
create constraint trigger crbn_forward_http
  after insert on net.http_request_queue
  deferrable initially deferred
  for each row execute function crbn.forward_http();

-- The copy in `postgres` is named <database>:<job name> and runs in this
-- database as the job's owner, as pg_cron would here: not as a superuser,
-- which would bypass RLS.
--
-- cron.unschedule deletes the row in C, where no trigger fires: crbn runs
-- crbn.sync_cron() after each migration run and on every `crbn up`, and a job
-- unscheduled by hand in psql runs on until then.
create or replace function crbn.cron_copy_name(j cron.job) returns text
language sql stable as $$
  select current_database() || ':' || coalesce(j.jobname, '#' || j.jobid)
$$;

create or replace function crbn.schedule_copy(j cron.job) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform crbn.remote(format(
    'select cron.schedule_in_database(%L, %L, %L, %L, %L)::text',
    crbn.cron_copy_name(j), j.schedule, j.command, current_database(), j.username));
end $$;

-- Only the copy of this job: 2 owners may each have a job of the same name.
create or replace function crbn.unschedule_copy(name text, owner text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform crbn.remote(format(
    'select count(cron.unschedule(jobid))::text from cron.job
      where jobname = %L and username = %L and database = %L',
    name, owner, current_database()));
end $$;
drop function if exists crbn.unschedule_copy(text);

-- A failure warns and does not fail the transaction (a migration): the next
-- crbn.sync_cron() repairs the copy.
create or replace function crbn.forward_cron() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform crbn.unschedule_copy(crbn.cron_copy_name(old), old.username);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.active then
    perform crbn.schedule_copy(new);
  end if;
  return null;
exception when others then
  raise warning 'crbn: cron job % not forwarded: %',
    crbn.cron_copy_name(coalesce(new, old)), sqlerrm;
  return null;
end $$;

drop trigger if exists crbn_forward_cron on cron.job;
create constraint trigger crbn_forward_cron
  after insert or update or delete on cron.job
  deferrable initially deferred
  for each row execute function crbn.forward_cron();

-- Makes the copies match this database's cron.job: for jobs that were here
-- before the trigger (a clone, a database from an older crbn, a restore).
-- One dblink round trip: remove the copies with no active job here, then
-- schedule (or update) a copy of every active job.
create or replace function crbn.sync_cron() returns void
language plpgsql security definer set search_path = '' as $$
declare
  names text[];
  jobs text;
begin
  select coalesce(array_agg(crbn.cron_copy_name(c)), '{}'),
         string_agg(format('(%L, %L, %L, %L)',
           crbn.cron_copy_name(c), c.schedule, c.command, c.username), ', ')
    into names, jobs
    from cron.job c where c.active;
  perform crbn.remote(format(
    'select count(cron.unschedule(jobid))::text from cron.job
      where database = %1$L and starts_with(jobname, %2$L) and jobname <> all (%3$L::text[])',
    current_database(), current_database() || ':', names)
    || case when jobs is null then '' else format(
    '; select count(cron.schedule_in_database(name, schedule, command, %L, username))::text
       from (values %s) as j(name, schedule, command, username)',
    current_database(), jobs) end);
exception when others then
  -- The migrations are in; a later sync (the next migration run or `crbn up`)
  -- schedules the copies.
  raise warning 'crbn: cron copies not synced: %', sqlerrm;
end $$;
