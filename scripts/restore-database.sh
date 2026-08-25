#!/usr/bin/env bash
#
# Restores a Supabase backup into this worktree's local Postgres, keeping
# all data (including emails) exactly as in prod. Accepts either a
# plain-text cluster dump (.backup) or a custom-format pg_dump archive
# (.dump) — the format is auto-detected. Optionally upgrades one user to
# Admin in the companies they already belong to.
#
# ⚠ NOTE: by default emails are NOT scrubbed — real production email addresses
#   will be present in the local DB. Make sure local email sending is disabled
#   or pointed at a sandbox (e.g. Mailpit) before triggering any email flows,
#   or pass SCRUB_EMAILS=1 to rewrite every email to *@example.test.
#
# Usage:
#   ./scripts/restore-database.sh /path/to/db_cluster-XX.backup
#   ./scripts/restore-database.sh /path/to/postgres_YYYYMMDD.dump
#
# Optional env vars:
#   ADMIN_EMAIL     your prod email — script looks it up, upgrades you to
#                   Admin in the companies you ALREADY belong to, then
#                   resets the password
#   ADMIN_PASSWORD  password to set on that account locally (default: localpass)
#   SCRUB_EMAILS    set to any non-empty value to scrub every email address
#                   (auth.users, auth.identities, public.user, company,
#                   contact, invite, companySettings, the AP/AR billing
#                   addresses, quote) to @example.test
#                   so no production emails can be contacted from local.
#                   The script FAILS (exit 1) if any non-admin email survives.
#                   The ADMIN_EMAIL account is preserved so you can still log in.
#   KEEP_STORAGE_OBJECTS
#                   set to any non-empty value to KEEP the dump's
#                   storage.objects/prefixes rows and its buckets instead of
#                   clearing them. File downloads still 404 (the bytes live in
#                   the source environment's backend, not the DB) — this is for
#                   work that needs realistic storage metadata volume, such as
#                   profiling RLS on storage listings.
#   RESTORE_MODE    'local' (default) or 'prod'.
#                   local: after restoring, localize environment-sensitive state —
#                     re-seed the config row to local Kong, deactivate webhooks /
#                     integrations / printer routes, blank printJob URLs, clear
#                     vault secrets, flush the Redis permission cache.
#                   prod: restore the data exactly as-is and skip ALL of the
#                     above — use when the target should keep behaving like
#                     the source environment (e.g. cloning into a real stack).
#
# Examples:
#   ADMIN_EMAIL=me@prod.com ./scripts/restore-database.sh ~/Downloads/db_cluster.backup
#   ADMIN_EMAIL=me@prod.com SCRUB_EMAILS=1 ./scripts/restore-database.sh ~/Downloads/db_cluster.backup
#   RESTORE_MODE=prod ./scripts/restore-database.sh ~/Downloads/db_cluster.backup
#
# Safety:
#   - Only ever connects to 127.0.0.1 on the port crbn assigned this worktree.
#   - Refuses to run if the worktree isn't registered in ~/.carbon/dev-ports.json.
#
set -euo pipefail
# Private, unpredictable error-log path (a fixed /tmp name is symlink-attackable
# and can be pre-created by another local user).
RESTORE_LOG="$(mktemp "${TMPDIR:-/tmp}/restore-errors.XXXXXX.log")"
RESTORE_INCOMPLETE=""
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-localpass}"
SCRUB_EMAILS="${SCRUB_EMAILS:-}"
KEEP_STORAGE_OBJECTS="${KEEP_STORAGE_OBJECTS:-}"
RESTORE_MODE="${RESTORE_MODE:-local}"
if [[ "$RESTORE_MODE" != "local" && "$RESTORE_MODE" != "prod" ]]; then
  echo "RESTORE_MODE must be 'local' or 'prod' (got '$RESTORE_MODE')" >&2
  exit 1
fi
BACKUP_FILE="${1:-}"
if [[ -z "$BACKUP_FILE" || ! -f "$BACKUP_FILE" ]]; then
  echo "usage: $0 <path-to-.backup-file>" >&2
  exit 1
fi
# Determine which Carbon worktree to restore into. Works no matter where this
# script file lives: prefer the git worktree of the current directory, then fall
# back to the git worktree containing the script itself.
REPO_ROOT="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null || true)"
fi
if [[ -z "$REPO_ROOT" ]]; then
  echo "Could not determine the Carbon worktree. Run this from inside the worktree you want to restore." >&2
  exit 1
fi
PORT_DB=$(node -e "
  const fs = require('fs'), path = require('path'), os = require('os');
  const reg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.carbon/dev-ports.json'), 'utf8'));
  for (const slot of Object.values(reg)) {
    if (path.resolve(slot.worktreeRoot) === '$REPO_ROOT') {
      process.stdout.write(String(slot.ports.PORT_DB));
      process.exit(0);
    }
  }
  console.error('No slot in ~/.carbon/dev-ports.json for $REPO_ROOT');
  process.exit(1);
")
export PGPASSWORD=postgres
PSQL_PG="psql -h 127.0.0.1 -p $PORT_DB -U postgres -d postgres"
PSQL_SA="psql -h 127.0.0.1 -p $PORT_DB -U supabase_admin -d postgres"
echo "▶ Local Postgres: 127.0.0.1:$PORT_DB"
$PSQL_PG -c 'SELECT 1' > /dev/null \
  || { echo "Postgres not reachable. Run 'crbn up' first." >&2; exit 1; }
# ── 1. Restore superuser on postgres (in case a prior dump demoted it) ──────
$PSQL_SA -c "ALTER ROLE postgres WITH SUPERUSER CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;" \
  >/dev/null 2>&1 || true
# ── 2. Drop existing public schema (per-object to avoid lock-table exhaustion)
echo "▶ Dropping existing public-schema objects"
$PSQL_PG -At -c "SELECT format('DROP TABLE IF EXISTS public.%I CASCADE;', tablename) FROM pg_tables WHERE schemaname='public'" \
  | $PSQL_PG -v ON_ERROR_STOP=0 >/dev/null
$PSQL_PG -At -c "
  SELECT format('DROP VIEW IF EXISTS public.%I CASCADE;', viewname) FROM pg_views WHERE schemaname='public'
  UNION ALL SELECT format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE;', matviewname) FROM pg_matviews WHERE schemaname='public'
  UNION ALL SELECT format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE;', p.proname, pg_get_function_identity_arguments(p.oid))
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public'
  UNION ALL SELECT format('DROP TYPE IF EXISTS public.%I CASCADE;', t.typname)
            FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
            WHERE n.nspname='public' AND t.typcategory IN ('E','C')
  UNION ALL SELECT format('DROP SEQUENCE IF EXISTS public.%I CASCADE;', sequencename) FROM pg_sequences WHERE schemaname='public'
" | $PSQL_PG -v ON_ERROR_STOP=0 >/dev/null
# Guarded the same way as the storage reset in step 5: on a stack that has only
# ever booted postgres (e.g. `crbn restore` right after a `crbn reset`), the
# service schemas do not exist yet -- storage.objects is created by the storage
# service's own migrations, not by the postgres image. A bare TRUNCATE there
# aborts the whole restore under `set -e`.
$PSQL_PG -c "
DO \$\$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN TRUNCATE auth.users CASCADE; END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN TRUNCATE storage.objects CASCADE; END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN TRUNCATE storage.buckets CASCADE; END IF;
END \$\$;
" >/dev/null
# ── 3. Restore ───────────────────────────────────────────────────────────────
# Supports both plain-text SQL dumps (Supabase cluster .backup files) and
# custom-format pg_dump archives (.dump, magic bytes 'PGDMP').
echo "▶ Restoring backup (this can take several minutes)"
if head -c 5 "$BACKUP_FILE" | grep -q '^PGDMP'; then
  echo "  → custom-format archive detected, using pg_restore"
  # `|| true`: pg_restore exits nonzero whenever ANY error occurred, including
  # the expected 'already exists' noise, so its exit code cannot gate the script.
  pg_restore -h 127.0.0.1 -p "$PORT_DB" -U supabase_admin -d postgres \
    --no-owner --no-privileges \
    "$BACKUP_FILE" 2> "$RESTORE_LOG" || true
  restore_pipe=(0 0)
else
  # Plain-text SQL: strip PG17 \restrict/\unrestrict so psql isn't sandboxed.
  # The pipeline must not run bare under `set -e`: if the server drops the
  # connection mid-restore (e.g. a crash on a schema-drifted COPY), psql exits
  # 2 and the script would die HERE — silently skipping localization, the
  # SCRUB_EMAILS scrub, and the admin grant, leaving real production emails in
  # the local DB with no warning. But a blanket `|| true` would ALSO swallow an
  # unreadable backup or a psql that never connected, so capture PIPESTATUS and
  # sort the failure modes out below.
  if sed -E '/^\\(restrict|unrestrict)([[:space:]]|$)/d' "$BACKUP_FILE" \
    | $PSQL_SA -v ON_ERROR_STOP=0 2> "$RESTORE_LOG"; then
    restore_pipe=(0 0)
  else
    restore_pipe=("${PIPESTATUS[@]}")
  fi
fi
err_count=$(grep -ci '^\(pg_restore: \)\?error' "$RESTORE_LOG" || true)
echo "  → $RESTORE_LOG ($err_count errors; most are harmless 'already exists' / role permission noise)"
# Sort out how the restore ended. A dropped server connection is the one
# failure we deliberately continue through (Docker restarts Postgres, and the
# post-restore safety steps — localization, email scrub — must still run over
# whatever data landed); the script then exits nonzero at the END. Note the
# connection-loss check comes first: when psql dies mid-pipe, sed is killed by
# SIGPIPE too, so its exit code is only meaningful when the connection held.
if grep -qE 'server closed the connection|connection to server was lost' "$RESTORE_LOG"; then
  RESTORE_INCOMPLETE=1
  echo "  ⚠ the server connection dropped during the restore — the restored data is"
  echo "    likely INCOMPLETE (see $RESTORE_LOG). Waiting for Postgres to"
  echo "    come back so the post-restore steps (email scrub, localization) still run."
elif [[ "${restore_pipe[0]:-0}" -ne 0 ]]; then
  echo "✗ Could not read the backup file (exit ${restore_pipe[0]}) — nothing was restored." >&2
  exit 1
elif [[ "${restore_pipe[1]:-0}" -ne 0 ]]; then
  echo "✗ psql failed before the data load completed (exit ${restore_pipe[1]}) — see $RESTORE_LOG" >&2
  exit 1
fi
for attempt in $(seq 1 30); do
  if $PSQL_PG -c 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "✗ Postgres did not come back after the restore. Nothing after the data load" >&2
    echo "  has run — including the SCRUB_EMAILS scrub. Start the stack ('crbn up')" >&2
    echo "  and re-run this script." >&2
    exit 1
  fi
  sleep 2
done
# Reapply superuser to postgres (the dump's ALTER ROLE strips it).
$PSQL_SA -c "ALTER ROLE postgres WITH SUPERUSER CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS;" \
  >/dev/null 2>&1 || true
# Realign pgmq queue sequences with restored max msg_id. The dump COPYs
# pgmq.q_* rows but doesn't reset the underlying sequences, so the first
# trigger-fired INSERT after restore collides on the primary key.
$PSQL_PG -c "
DO \$\$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgmq' AND c.relname LIKE 'q\_%' AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'SELECT setval(pg_get_serial_sequence(%L, ''msg_id''), GREATEST(1, COALESCE((SELECT max(msg_id) FROM pgmq.%I), 1)))',
      'pgmq.' || r.relname, r.relname
    );
  END LOOP;
END \$\$;
" >/dev/null 2>&1 || true
# pgmq queue tables restored from a prod DB whose queues predate pgmq >= 1.4 are
# missing the `headers` column the local pgmq read/send functions write to. This
# surfaces at runtime as: `column m.headers does not exist` (from pgmq.read/send,
# e.g. packages/jobs event queue). The dump also omits the pgmq.meta registry
# rows, so list_queues() comes back empty. Backfill both directly against the
# restored q_*/a_* tables — idempotent, safe on fresh DBs (no queues → no-op).
echo "▶ Backfilling pgmq queue headers + meta registry"
$PSQL_PG -c "
DO \$\$
DECLARE t RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgmq') THEN RETURN; END IF;
  FOR t IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgmq' AND c.relkind = 'r'
      AND (c.relname LIKE 'q\_%' OR c.relname LIKE 'a\_%')
  LOOP
    EXECUTE format('ALTER TABLE pgmq.%I ADD COLUMN IF NOT EXISTS headers JSONB', t.relname);
  END LOOP;
END \$\$;
INSERT INTO pgmq.meta (queue_name, is_partitioned, is_unlogged, created_at)
SELECT substring(c.relname FROM 3), false, false, now()
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'pgmq' AND c.relkind = 'r' AND c.relname LIKE 'q\_%'
ON CONFLICT (queue_name) DO NOTHING;
" >/dev/null 2>&1 || true
# Storage: custom-format dumps DO carry storage.objects/prefixes rows, but
# the actual file bytes live in prod's storage backend, not in the DB — so
# those rows would point at files that don't exist locally and downloads
# would 404. Clear the metadata, keep/create the buckets the app expects.
if [[ -n "$KEEP_STORAGE_OBJECTS" ]]; then
  # Opt-in: keep the dump's storage rows AND its buckets. Downloads still 404
  # (the bytes are in the source environment's backend, not the DB) — this
  # exists for work that needs realistic storage.objects volume, e.g. profiling
  # the RLS on storage listings, which is unmeasurable against an empty table.
  # Buckets are kept too: the objects reference buckets that the re-seed below
  # does not recreate (`temp-staging` is neither a fixed bucket nor a company),
  # so truncating them would strand those rows on a missing FK.
  echo "▶ Keeping storage metadata (KEEP_STORAGE_OBJECTS) — downloads will 404 locally"
else
  echo "▶ Resetting storage metadata + ensuring buckets (fixed + per-company)"
  # Guard each TRUNCATE with to_regclass so a table that doesn't exist in this
  # Supabase version can't abort — and thereby roll back — the whole block.
  $PSQL_SA -v ON_ERROR_STOP=0 -c "
DO \$\$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN TRUNCATE storage.objects CASCADE; END IF;
  IF to_regclass('storage.prefixes') IS NOT NULL THEN TRUNCATE storage.prefixes CASCADE; END IF;
  IF to_regclass('storage.s3_multipart_uploads_parts') IS NOT NULL THEN TRUNCATE storage.s3_multipart_uploads_parts CASCADE; END IF;
  IF to_regclass('storage.s3_multipart_uploads') IS NOT NULL THEN TRUNCATE storage.s3_multipart_uploads CASCADE; END IF;
  IF to_regclass('storage.buckets') IS NOT NULL THEN TRUNCATE storage.buckets CASCADE; END IF;
END \$\$;
" >/dev/null 2>&1 || true
fi
# Re-seed buckets in a SEPARATE statement so the TRUNCATE outcome above can never
# roll it back: the fixed app buckets plus one private bucket per restored
# company (id = company id), matching the bucket-seeding migrations.
$PSQL_SA -v ON_ERROR_STOP=0 -c "
INSERT INTO storage.buckets (id, name, public) VALUES
  ('public',            'public',            true),
  ('avatars',           'avatars',           true),
  ('private',           'private',           false),
  ('feedback',          'feedback',          true),
  ('company-templates', 'company-templates', false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public)
SELECT id, id, false FROM public.company
ON CONFLICT (id) DO NOTHING;
" >/dev/null 2>&1 || true
BUCKET_COUNT=$($PSQL_PG -At -c "SELECT count(*) FROM storage.buckets;" 2>/dev/null || echo "?")
echo "  ✓ $BUCKET_COUNT storage buckets present (5 fixed + one per company)"
# ── 3b. Localize environment-sensitive rows (RESTORE_MODE=local only) ───────
if [[ "$RESTORE_MODE" == "local" ]]; then
# The dump carries prod's singleton "config" row (the pg_net push target that
# SECURITY DEFINER functions like util.wake_event_queue and the webhook
# triggers POST through), plus live webhook URLs, integration OAuth tokens,
# and printer-route ProxyBox URLs. Left as-is, the local event queue never
# drains (audit logs stay empty — the doorbell rings PROD's edge function),
# and local edits can deliver real webhooks / Slack / Xero posts / print jobs.
echo "▶ Localizing config row + deactivating webhooks, integrations, printer routes"
ANON_KEY=$(grep '^SUPABASE_ANON_KEY=' "$REPO_ROOT/.env.local" 2>/dev/null | cut -d= -f2- || true)
if [[ -n "$ANON_KEY" ]]; then
  # Same values crbn seeds (packages/dev/src/services/migrations.ts
  # ensureConfigRow): apiUrl must be the in-network Kong URL — pg_net runs
  # inside the postgres container and can't reach host ports.
  $PSQL_PG -v ON_ERROR_STOP=0 -v anon_key="$ANON_KEY" <<'SQL' >/dev/null
INSERT INTO "config" ("id", "apiUrl", "anonKey")
VALUES (TRUE, 'http://kong:8000', :'anon_key')
ON CONFLICT ("id") DO UPDATE
  SET "apiUrl" = EXCLUDED."apiUrl", "anonKey" = EXCLUDED."anonKey";
SQL
  echo "  ✓ config row → http://kong:8000 with local anon key"
else
  echo "  ⚠ SUPABASE_ANON_KEY not found in $REPO_ROOT/.env.local — config row still"
  echo "    points at prod: the event queue (audit logs, webhooks) will NOT process"
  echo "    locally until 'crbn up' reseeds it or you update public.config manually."
fi
$PSQL_PG -v ON_ERROR_STOP=0 <<'SQL' >/dev/null
SET session_replication_role = 'replica';
DO $$
BEGIN
  IF to_regclass('public.webhook') IS NOT NULL THEN
    EXECUTE 'UPDATE public.webhook SET active = false WHERE active';
  END IF;
  IF to_regclass('public."companyIntegration"') IS NOT NULL THEN
    EXECUTE 'UPDATE public."companyIntegration" SET active = false WHERE active';
  END IF;
  IF to_regclass('public."printerRoute"') IS NOT NULL THEN
    EXECUTE 'UPDATE public."printerRoute" SET "printerUrl" = '''', "apiKey" = NULL WHERE COALESCE("printerUrl", '''') <> ''''';
  END IF;
  -- Old prod print jobs keep their delivered-to ProxyBox URL; blank it so a
  -- local "reprint" can never target a real printer.
  IF to_regclass('public."printJob"') IS NOT NULL THEN
    EXECUTE 'UPDATE public."printJob" SET "printerUrl" = '''' WHERE COALESCE("printerUrl", '''') <> ''''';
  END IF;
  -- The dump carries prod vault rows (e.g. AWS credentials). They are
  -- encrypted with prod's root key so they can't be decrypted locally,
  -- but there is no reason to keep them around.
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    EXECUTE 'DELETE FROM vault.secrets';
  END IF;
END $$;
SQL
echo "  ✓ webhooks, integrations, printer routes/jobs deactivated; vault secrets cleared"
# Flush cached permission claims: requirePermissions serves claims from Redis
# (permissions:<userId>), so anyone logged in before the restore would keep
# their PRE-restore permissions silently. Same failure shape as the stale
# config row — the DB is right but a side channel serves old data.
REDIS_URL_LOCAL=$(grep '^REDIS_URL=' "$REPO_ROOT/.env.local" 2>/dev/null | cut -d= -f2- || true)
if [[ -n "$REDIS_URL_LOCAL" ]] && command -v redis-cli >/dev/null 2>&1; then
  STALE_KEYS=$(redis-cli -u "$REDIS_URL_LOCAL" --scan --pattern 'permissions:*' 2>/dev/null || true)
  if [[ -n "$STALE_KEYS" ]]; then
    echo "$STALE_KEYS" | xargs redis-cli -u "$REDIS_URL_LOCAL" DEL >/dev/null 2>&1 || true
  fi
  echo "  ✓ Redis permission cache flushed ($REDIS_URL_LOCAL)"
else
  echo "  ⚠ redis-cli or REDIS_URL not available — if you were logged in before the"
  echo "    restore, log OUT and back IN so cached permissions are refreshed."
fi
else
  echo "▶ RESTORE_MODE=prod — restoring as-is: keeping config row, webhooks,"
  echo "  integrations, printer routes, vault secrets, and caches untouched."
fi
# ── 4. If ADMIN_EMAIL is set, resolve the user_id ───────────────────────────
ADMIN_USER_ID=""
if [[ -n "$ADMIN_EMAIL" ]]; then
  ADMIN_USER_ID=$($PSQL_PG -At -c "SELECT id FROM public.\"user\" WHERE lower(email) = lower('$ADMIN_EMAIL') LIMIT 1" || true)
  if [[ -z "$ADMIN_USER_ID" ]]; then
    echo "  ⚠ ADMIN_EMAIL=$ADMIN_EMAIL not found in public.user — skipping access grant"
  else
    echo "  ✓ Found user $ADMIN_USER_ID for $ADMIN_EMAIL — will upgrade to Admin in existing companies"
  fi
fi
# ── 4a. Scrub every real email → @example.test (opt-in via SCRUB_EMAILS) ────
# (skips the ADMIN_USER_ID user across all auth + public.user tables so the
#  admin can keep logging in with their real prod email)
if [[ -n "$SCRUB_EMAILS" ]]; then
  echo "▶ Scrubbing emails → *@example.test  (preserving admin account)"
  $PSQL_PG -v ON_ERROR_STOP=0 -v admin_uid="${ADMIN_USER_ID:-}" <<'SQL' >/dev/null
-- Disable triggers during scrub: the event-system queue would otherwise
-- fire for each updated row and we don't need those side effects.
SET session_replication_role = 'replica';

-- auth.users: replace email + clear pending email-change / token state
-- (skip the admin so they keep their real prod email)
UPDATE auth.users SET
  email                       = 'u_' || left(md5(id::text), 10) || '@example.test',
  email_change                = NULL,
  email_change_token_new      = '',
  email_change_token_current  = '',
  recovery_token              = '',
  confirmation_token          = '',
  raw_user_meta_data          = COALESCE(raw_user_meta_data - 'email', '{}'::jsonb)
                                || jsonb_build_object('email', 'u_' || left(md5(id::text), 10) || '@example.test')
WHERE (email IS NOT NULL OR raw_user_meta_data ? 'email')
  AND (:'admin_uid' = '' OR id::text <> :'admin_uid');

-- auth.identities.email is GENERATED from identity_data->>'email' —
-- update the source JSON only, and skip the admin's identities.
UPDATE auth.identities SET
  identity_data = COALESCE(identity_data - 'email', '{}'::jsonb)
                  || jsonb_build_object('email', 'u_' || left(md5(user_id::text), 10) || '@example.test')
WHERE identity_data ? 'email'
  AND (:'admin_uid' = '' OR user_id::text <> :'admin_uid');

-- public.user: same skip
UPDATE public."user" SET
  email = 'u_' || left(md5(id::text), 10) || '@example.test'
WHERE email IS NOT NULL
  AND (:'admin_uid' = '' OR id <> :'admin_uid');

-- Helper: scrub a (table, column) pair only if the column exists and is not generated.
-- public.user is handled above so we don't need an admin-skip inside the loop.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public', 'company',         'email',                       'co_'),
      ('public', 'contact',         'email',                       'ct_'),
      ('public', 'invite',          'email',                       'inv_'),
      ('public', 'companySettings', 'accountsPayableEmail',        'ap_'),
      ('public', 'companySettings', 'accountsReceivableEmail',     'ar_'),
      ('public', 'companyAccountsPayableBillingAddress',    'email', 'apb_'),
      ('public', 'companyAccountsReceivableBillingAddress', 'email', 'arb_'),
      ('public', 'quote',           'digitalQuoteAcceptedByEmail', 'qa_'),
      ('public', 'quote',           'digitalQuoteRejectedByEmail', 'qr_')
    ) AS t(schema_name, table_name, column_name, prefix)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = r.schema_name AND table_name = r.table_name
        AND column_name = r.column_name AND is_generated = 'NEVER'
    ) THEN
      EXECUTE format(
        'UPDATE %I.%I SET %I = %L || left(md5(id::text), 10) || %L WHERE %I IS NOT NULL',
        r.schema_name, r.table_name, r.column_name,
        r.prefix, '@example.test', r.column_name
      );
    END IF;
  END LOOP;
END $$;
SQL
fi
# ── 5. Upgrade admin in user's existing companies ───────────────────────────
# Scope is intentionally narrow: only the companies the user already
# belongs to from prod. Granting the user access to all 1000+ tenants
# blows past PostgREST's statement timeout (RLS array checks on
# 1300-element arrays + the `employees` view).
if [[ -n "$ADMIN_USER_ID" ]]; then
  echo "▶ Upgrading $ADMIN_USER_ID to Admin in their existing companies"
  $PSQL_PG -v ON_ERROR_STOP=1 -v uid="$ADMIN_USER_ID" -v pw="$ADMIN_PASSWORD" <<'SQL' >/dev/null
SET session_replication_role = 'replica';
-- Upgrade (or create) the employee row to Admin in every company the
-- user belongs to. Falls back to that company's first employeeType
-- if no Admin type exists; skips companies with no employeeType at all.
INSERT INTO public.employee (id, "companyId", "employeeTypeId", active)
SELECT :'uid', uc."companyId",
       COALESCE(
         (SELECT et.id FROM public."employeeType" et WHERE et."companyId" = uc."companyId" AND et.name = 'Admin' LIMIT 1),
         (SELECT et.id FROM public."employeeType" et WHERE et."companyId" = uc."companyId" LIMIT 1)
       ),
       true
FROM public."userToCompany" uc
WHERE uc."userId" = :'uid'
  AND EXISTS (SELECT 1 FROM public."employeeType" et WHERE et."companyId" = uc."companyId")
ON CONFLICT (id, "companyId") DO UPDATE
  SET "employeeTypeId" = EXCLUDED."employeeTypeId", active = true;
-- Convert the user into a password-auth-capable account, regardless of
-- whether they originally signed up via Google / GitHub / etc. Supabase
-- gates password sign-in on (a) encrypted_password being set, (b) the
-- account being confirmed, and (c) an auth.identities row with
-- provider='email'.
-- confirmed_at is a GENERATED column in newer Supabase (least of
-- email_confirmed_at, phone_confirmed_at) — set the source instead.
UPDATE auth.users SET
  encrypted_password = crypt(:'pw', gen_salt('bf')),
  email_confirmed_at = COALESCE(email_confirmed_at, now()),
  aud                = COALESCE(NULLIF(aud, ''), 'authenticated'),
  role               = COALESCE(NULLIF(role, ''), 'authenticated'),
  banned_until       = NULL
WHERE id = :'uid';
-- Ensure an email-provider identity exists (idempotent).
-- auth.identities.email is a GENERATED column from identity_data->>'email',
-- so we don't include it in the column list.
INSERT INTO auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  u.id,
  u.id::text,
  'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
FROM auth.users u
WHERE u.id = :'uid'
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email'
  );
-- Permissions are stored flat per-user in public.userPermission as
-- { "<module>_<action>": ["companyId", ...] } and read at request time
-- (not from employeeTypePermission). Without this expansion the user
-- only sees nav modules in the companies their permissions row already
-- listed — typically just their original prod companies.
WITH all_companies AS (
  SELECT jsonb_agg(DISTINCT "companyId") AS ids
  FROM public."userToCompany"
  WHERE "userId" = :'uid'
)
UPDATE public."userPermission" SET
  permissions = (
    SELECT jsonb_object_agg(key, (SELECT ids FROM all_companies))
    FROM jsonb_object_keys(permissions) AS key
  )
WHERE id = :'uid';
SQL
  LOGIN_EMAIL=$($PSQL_PG -At -c "SELECT email FROM auth.users WHERE id = '$ADMIN_USER_ID';")
  COMPANY_COUNT=$($PSQL_PG -At -c "SELECT count(*) FROM public.\"userToCompany\" WHERE \"userId\" = '$ADMIN_USER_ID';")
  echo "  ✓ $ADMIN_USER_ID is Admin in $COMPANY_COUNT companies with full module permissions"
  echo "  ✓ Login as:  $LOGIN_EMAIL  /  $ADMIN_PASSWORD"
  echo "  ℹ If you were already logged in: log OUT and back IN — the permission"
  echo "    cache (Redis: permissions:$ADMIN_USER_ID) is cleared on logout."
fi
if [[ -n "$SCRUB_EMAILS" ]]; then
  echo "▶ Verifying scrub (the admin account is expected to remain, if preserved)"
  $PSQL_PG -c "
    SELECT 'auth.users leaked'  AS check, count(*) FROM auth.users      WHERE email IS NOT NULL AND email NOT LIKE '%@example.test'
    UNION ALL SELECT 'public.user leaked',  count(*) FROM public.\"user\"     WHERE email IS NOT NULL AND email NOT LIKE '%@example.test'
    UNION ALL SELECT 'public.company leaked', count(*) FROM public.company   WHERE email IS NOT NULL AND email NOT LIKE '%@example.test'
    UNION ALL SELECT 'public.contact leaked', count(*) FROM public.contact   WHERE email IS NOT NULL AND email NOT LIKE '%@example.test';
  "
  # The scrub was explicitly requested, so an incomplete one is a FAILURE, not
  # a table of numbers to eyeball. Only the preserved admin may remain (one row
  # each in auth.users and public.user). The assertion walks the SAME
  # (table, column) mapping the scrub does — guarded by information_schema, so
  # a dump predating one of the tables passes instead of erroring — and any
  # column added to the scrub must be added here too.
  LEAKED=$($PSQL_PG -Atq <<'SQL'
CREATE TEMP TABLE _scrub_leaks(n BIGINT);
DO $$
DECLARE
  r RECORD;
  c BIGINT;
  total BIGINT := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('auth',   'users',           'email'),
      ('public', 'user',            'email'),
      ('public', 'company',         'email'),
      ('public', 'contact',         'email'),
      ('public', 'invite',          'email'),
      ('public', 'companySettings', 'accountsPayableEmail'),
      ('public', 'companySettings', 'accountsReceivableEmail'),
      ('public', 'companyAccountsPayableBillingAddress',    'email'),
      ('public', 'companyAccountsReceivableBillingAddress', 'email'),
      ('public', 'quote',           'digitalQuoteAcceptedByEmail'),
      ('public', 'quote',           'digitalQuoteRejectedByEmail')
    ) AS t(schema_name, table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = r.schema_name AND table_name = r.table_name
        AND column_name = r.column_name
    ) THEN
      EXECUTE format(
        'SELECT count(*) FROM %I.%I WHERE %I IS NOT NULL AND %I NOT LIKE %L',
        r.schema_name, r.table_name, r.column_name, r.column_name, '%@example.test'
      ) INTO c;
      total := total + c;
    END IF;
  END LOOP;
  INSERT INTO _scrub_leaks VALUES (total);
END $$;
SELECT n FROM _scrub_leaks;
SQL
  )
  ALLOWED=0
  [[ -n "$ADMIN_USER_ID" ]] && ALLOWED=2
  # An EMPTY result means the verification query itself failed — refuse rather
  # than let a broken check read as a clean scrub.
  if [[ -z "$LEAKED" ]]; then
    echo "✗ The scrub verification query failed — treat the scrub as NOT verified." >&2
    exit 1
  fi
  if [[ "$LEAKED" -gt "$ALLOWED" ]]; then
    echo "✗ SCRUB_EMAILS was set but $LEAKED real email addresses remain (see the" >&2
    echo "  counts above). The restore may have failed partway — check" >&2
    echo "  $RESTORE_LOG, then re-run this script." >&2
    exit 1
  fi
fi
# An interrupted data load is a failed restore even though the safety steps
# above ran — exit nonzero so callers (crbn restore, CI) see it.
if [[ -n "$RESTORE_INCOMPLETE" ]]; then
  echo "✗ The server connection dropped during the restore, so the data load is likely" >&2
  echo "  incomplete. Localization and the email scrub DID run over what landed." >&2
  echo "  Check $RESTORE_LOG, then re-run this script end-to-end." >&2
  exit 1
fi
echo "✅ Done — Studio: http://127.0.0.1:$((PORT_DB+2))   (port_db+2 is the Studio port crbn assigned)"
