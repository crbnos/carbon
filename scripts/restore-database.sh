#!/usr/bin/env bash
#
# Restores a Supabase backup into this worktree's local Postgres, keeping
# all data (including emails) exactly as in prod. Accepts either a
# plain-text cluster dump (.backup) or a custom-format pg_dump archive
# (.dump) — the format is auto-detected. Optionally upgrades one user to
# Admin in the companies they already belong to.
#
# ⚠ NOTE: emails are NOT scrubbed — real production email addresses will be
#   present in the local DB. Make sure local email sending is disabled or
#   pointed at a sandbox (e.g. Mailpit) before triggering any email flows.
#
# Usage:
#   ./packages/database/scripts/restore-prod-backup.sh /path/to/db_cluster-XX.backup
#   ./packages/database/scripts/restore-prod-backup.sh /path/to/postgres_YYYYMMDD.dump
#
# Optional env vars:
#   ADMIN_EMAIL     your prod email — script looks it up, upgrades you to
#                   Admin in the companies you ALREADY belong to, then
#                   resets the password
#   ADMIN_PASSWORD  password to set on that account locally (default: localpass)
#
# Examples:
#   ADMIN_EMAIL=me@prod.com ./packages/database/scripts/restore-prod-backup.sh ~/Downloads/db_cluster.backup
#
# Safety:
#   - Only ever connects to 127.0.0.1 on the port crbn assigned this worktree.
#   - Refuses to run if the worktree isn't registered in ~/.carbon/dev-ports.json.
#
set -euo pipefail
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-localpass}"
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
$PSQL_PG -c "TRUNCATE auth.users CASCADE; TRUNCATE storage.objects CASCADE; TRUNCATE storage.buckets CASCADE;" >/dev/null
# ── 3. Restore ───────────────────────────────────────────────────────────────
# Supports both plain-text SQL dumps (Supabase cluster .backup files) and
# custom-format pg_dump archives (.dump, magic bytes 'PGDMP').
echo "▶ Restoring backup (this can take several minutes)"
if head -c 5 "$BACKUP_FILE" | grep -q '^PGDMP'; then
  echo "  → custom-format archive detected, using pg_restore"
  pg_restore -h 127.0.0.1 -p "$PORT_DB" -U supabase_admin -d postgres \
    --no-owner --no-privileges \
    "$BACKUP_FILE" 2> /tmp/restore-errors.log || true
else
  # Plain-text SQL: strip PG17 \restrict/\unrestrict so psql isn't sandboxed
  sed -E '/^\\(restrict|unrestrict)([[:space:]]|$)/d' "$BACKUP_FILE" \
    | $PSQL_SA -v ON_ERROR_STOP=0 2> /tmp/restore-errors.log
fi
err_count=$(grep -ci '^\(pg_restore: \)\?error' /tmp/restore-errors.log || true)
echo "  → /tmp/restore-errors.log ($err_count errors; most are harmless 'already exists' / role permission noise)"
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
echo "✅ Done — Studio: http://127.0.0.1:$((PORT_DB+2))   (port_db+2 is the Studio port crbn assigned)"
