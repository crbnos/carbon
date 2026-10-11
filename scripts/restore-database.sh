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
# and can be pre-created by another local user). The X's must END the template:
# BSD mktemp (macOS) only replaces trailing X's, so a ".log" suffix left the
# literal name restore-errors.XXXXXX.log — fixed, and refused on the next run.
RESTORE_LOG="$(mktemp "${TMPDIR:-/tmp}/restore-errors.XXXXXX")"
# Scratch files for this run (column map, filter stats, object lists).
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/restore-work.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
RESTORE_INCOMPLETE=""
RESTORE_UNVERIFIED=""
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
# The migration ledger must travel WITH the schema. The public schema was just
# dropped, so the local supabase_migrations ledger no longer describes anything
# real — and left in place it survives the restore (the dump's own ledger rows
# lose their primary-key conflicts under ON_ERROR_STOP=0), pairing the dump's
# OLDER schema with the local NEWER ledger. The post-restore "apply migrations
# the backup predates" step then no-ops and the DB is silently missing weeks of
# migrations. Truncate it so the dump's ledger lands cleanly; anything the
# backup predates then genuinely pends.
$PSQL_PG -c "
DO \$\$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    TRUNCATE supabase_migrations.schema_migrations;
  END IF;
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
  restore_pipe=(0 0 0)
else
  # Plain-text SQL: strip PG17 \restrict/\unrestrict so psql isn't sandboxed.
  # The pipeline must not run bare under `set -e`: if the server drops the
  # connection mid-restore (e.g. a crash on a schema-drifted COPY), psql exits
  # 2 and the script would die HERE — silently skipping localization, the
  # SCRUB_EMAILS scrub, and the admin grant, leaving real production emails in
  # the local DB with no warning. But a blanket `|| true` would ALSO swallow an
  # unreadable backup or a psql that never connected, so capture PIPESTATUS and
  # sort the failure modes out below.
  #
  # Fit every non-public COPY block to the LOCAL table before psql sees it.
  # The auth/storage/realtime tables already exist here, built by THIS stack's
  # GoTrue/Storage/Realtime images, and their columns drift from the source's
  # (storage.objects gained "archived_at" in prod before it did locally). A
  # COPY naming a column or table that doesn't exist fails at PARSE time, so
  # psql never enters copy mode and reads the block's data rows as SQL. One
  # unbalanced quote in that data then swallows the rest of the file: every
  # index, constraint, trigger and policy, and the migration ledger — after
  # which the trailing `migration up --include-all` replays every migration.
  # So: drop the columns the local table lacks (dropping each row's matching
  # field), and drop the whole block when a local schema lacks the table
  # (realtime's dated message partitions). A schema that doesn't exist locally
  # is the dump's own to create and passes through untouched; so does public,
  # dropped above. Generated columns count as absent: COPY refuses them too.
  #
  # The same drift reaches DDL: the backup carries the source's NEWER service
  # functions (storage.protect_bucket_control_columns), and the trigger it then
  # creates reads columns this stack's storage.buckets lacks — every bucket
  # insert fails, the re-seed below included. Functions owned by a service's
  # admin role belong to THIS stack's image, so the backup's are skipped: one
  # that exists locally would only fail "already exists" anyway, and a trigger
  # calling one that doesn't fails to create, harmlessly.
  COLUMN_MAP="$WORK_DIR/local-columns.txt"
  COPY_STATS="$WORK_DIR/copy-filter.txt"
  $PSQL_SA -At -c "
    SELECT n.nspname || '.' || c.relname || '|' || a.attname
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND a.attnum > 0
      AND NOT a.attisdropped AND a.attgenerated = ''
      AND n.nspname NOT IN ('public', 'information_schema')
      AND n.nspname NOT LIKE 'pg\_%'
    UNION ALL
    SELECT nspname || '|' FROM pg_namespace
    WHERE nspname NOT IN ('public', 'information_schema')
      AND nspname NOT LIKE 'pg\_%'
  " > "$COLUMN_MAP"
  if sed -E '/^\\(restrict|unrestrict)([[:space:]]|$)/d' "$BACKUP_FILE" \
    | awk -v map="$COLUMN_MAP" -v stats="$COPY_STATS" '
      function unquote(s) { gsub(/"/, "", s); return s }
      BEGIN {
        while ((getline line < map) > 0) {
          bar = index(line, "|")
          key = substr(line, 1, bar - 1); col = substr(line, bar + 1)
          if (col == "") localSchema[key] = 1; else { localTable[key] = 1; localCol[key "|" col] = 1 }
        }
      }
      mode == "skip" { if ($0 == "\\.") mode = ""; next }
      mode == "data" { print; if ($0 == "\\.") mode = ""; next }
      mode == "project" {
        if ($0 == "\\.") { mode = ""; print; next }
        n = split($0, f, "\t"); out = ""
        for (i = 1; i <= kept; i++) out = out (i > 1 ? "\t" : "") f[keep[i]]
        print out; next
      }
      # A skipped function runs up to the next object header, which is then
      # handled below like any other line.
      mode == "function" { if ($0 !~ /^-- Name: /) next; mode = "" }
      /^-- Name: .*; Type: FUNCTION; Schema: [a-z_]+; Owner: supabase_(auth|storage|realtime|functions)_admin$/ {
        mode = "function"; functions++; next
      }
      /^COPY public\./ { print; mode = "data"; next }
      /^COPY / {
        open = index($0, " ("); table = unquote(substr($0, 6, open - 6))
        schema = substr(table, 1, index(table, ".") - 1)
        if (!(schema in localSchema)) { print; mode = "data"; next }
        if (!(table in localTable)) {
          mode = "skip"; print "skipped " table " (no such table here)" > stats; next
        }
        cols = substr($0, open + 2); cols = substr(cols, 1, index(cols, ") FROM stdin;") - 1)
        n = split(cols, c, ", "); kept = 0; header = ""; dropped = ""
        for (i = 1; i <= n; i++) {
          if ((table "|" unquote(c[i])) in localCol) { keep[++kept] = i; header = header (kept > 1 ? ", " : "") c[i] }
          else dropped = dropped " " unquote(c[i])
        }
        if (dropped == "") { print; mode = "data"; next }
        if (kept == 0) { mode = "skip"; print "skipped " table " (no shared columns)" > stats; next }
        mode = "project"; print "trimmed " table " (dropped:" dropped ")" > stats
        print "COPY " substr($0, 6, open - 6) " (" header ") FROM stdin;"; next
      }
      { print }
      END { if (functions) print "kept this stack'"'"'s own service functions (skipped the backup'"'"'s " functions ")" > stats }
    ' \
    | $PSQL_SA -v ON_ERROR_STOP=0 2> "$RESTORE_LOG"; then
    restore_pipe=(0 0 0)
  else
    restore_pipe=("${PIPESTATUS[@]}")
  fi
  if [[ -s "$COPY_STATS" ]]; then
    echo "  → fitted the backup to this stack's auth/storage/realtime schemas:"
    sed 's/^/      /' "$COPY_STATS"
  fi
fi
err_count=$(grep -ci '^\(pg_restore: \)\?error' "$RESTORE_LOG" || true)
echo "  → $RESTORE_LOG ($err_count errors; most are harmless 'already exists' / role permission noise)"
# Sort out how the restore ended. A dropped server connection is the one
# failure we deliberately continue through (Docker restarts Postgres, and the
# post-restore safety steps — localization, email scrub — must still run over
# whatever data landed); the script then exits nonzero at the END. Note the
# connection-loss check comes first: when psql dies mid-pipe, sed and awk are
# killed by SIGPIPE too, so their exit codes only mean something when the
# connection held. restore_pipe is (sed, awk, psql).
if grep -qE 'server closed the connection|connection to server was lost' "$RESTORE_LOG"; then
  RESTORE_INCOMPLETE=1
  echo "  ⚠ the server connection dropped during the restore — the restored data is"
  echo "    likely INCOMPLETE (see $RESTORE_LOG). Waiting for Postgres to"
  echo "    come back so the post-restore steps (email scrub, localization) still run."
elif [[ "${restore_pipe[0]:-0}" -ne 0 ]]; then
  echo "✗ Could not read the backup file (exit ${restore_pipe[0]}) — nothing was restored." >&2
  exit 1
elif [[ "${restore_pipe[1]:-0}" -ne 0 ]]; then
  echo "✗ The COPY filter failed (exit ${restore_pipe[1]}) — nothing past that point was restored." >&2
  exit 1
elif [[ "${restore_pipe[2]:-0}" -ne 0 ]]; then
  echo "✗ psql failed before the data load completed (exit ${restore_pipe[2]}) — see $RESTORE_LOG" >&2
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
# ── 3a. Verify the schema landed ────────────────────────────────────────────
# psql under ON_ERROR_STOP=0 reports a restore that lost its whole post-data
# section exactly like a clean one, so check by NAME: every index, constraint,
# trigger and policy the dump defines in public must exist now (public was
# dropped first, so everything there came from the dump), and the migration
# ledger must hold every row the dump's does — a short ledger makes the
# trailing `migration up --include-all` replay migrations onto a schema that
# already has them.
echo "▶ Verifying the restored schema against the backup"
# Every read below tolerates failure (|| true): this runs BEFORE the email
# scrub, so it must never abort the script. A read that fails leaves its
# expectation empty or its live side short, which reports as ✗ below.
EXPECTED_OBJECTS="$WORK_DIR/expected-objects.txt"
LIVE_OBJECTS="$WORK_DIR/live-objects.txt"
MISSING_OBJECTS="$WORK_DIR/missing-objects.txt"
POST_DATA_SQL="$WORK_DIR/post-data.sql"
if head -c 5 "$BACKUP_FILE" | grep -q '^PGDMP'; then
  pg_restore -l "$BACKUP_FILE" \
    | sed -nE 's/^[0-9]+; [0-9]+ [0-9]+ (INDEX|CONSTRAINT|FK CONSTRAINT|TRIGGER|POLICY) public (.*) [^ ]+$/\1|\2/p' \
    > "$EXPECTED_OBJECTS" || true
  pg_restore --section=post-data -f "$POST_DATA_SQL" "$BACKUP_FILE" 2>>"$RESTORE_LOG" || true
  EXPECTED_LEDGER=$(pg_restore -a -n supabase_migrations -t schema_migrations -f - "$BACKUP_FILE" 2>>"$RESTORE_LOG" \
    | awk '/^COPY /{on=1; next} /^\\\.$/{on=0} on{n++} END{print n+0}' || true)
else
  # pg_dump heads every object with "-- Name: <tag>; Type: <type>; Schema: <schema>;".
  sed -nE 's/^-- Name: (.*); Type: (INDEX|CONSTRAINT|FK CONSTRAINT|TRIGGER|POLICY); Schema: public;.*/\2|\1/p' \
    "$BACKUP_FILE" > "$EXPECTED_OBJECTS"
  POST_DATA_SQL="$BACKUP_FILE"
  EXPECTED_LEDGER=$(awk '/^COPY supabase_migrations\.schema_migrations /{on=1; next} on && /^\\\.$/{exit} on{n++} END{print n+0}' "$BACKUP_FILE")
fi
list_live_objects() {
  $PSQL_PG -At -c "
    SELECT 'INDEX|' || c.relname
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT CASE WHEN con.contype = 'f' THEN 'FK CONSTRAINT|' ELSE 'CONSTRAINT|' END
           || rel.relname || ' ' || con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
    UNION ALL
    SELECT 'TRIGGER|' || rel.relname || ' ' || t.tgname
    FROM pg_trigger t
    JOIN pg_class rel ON rel.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'POLICY|' || tablename || ' ' || policyname FROM pg_policies WHERE schemaname = 'public'
  " 2>>"$RESTORE_LOG" | LC_ALL=C sort -u > "$LIVE_OBJECTS" || true
  LC_ALL=C sort -u "$EXPECTED_OBJECTS" | LC_ALL=C comm -23 - "$LIVE_OBJECTS" > "$MISSING_OBJECTS"
}
list_live_objects
# A Supabase backup is not one consistent snapshot: rows written while it ran
# can reference parents that were dumped before them (seen: payments whose
# journal is absent from the dump). Such a foreign key cannot be validated, so
# it is re-added NOT VALID — the schema matches the source, the existing
# orphans stay as they were, and new writes and cascades are enforced.
if grep -q '^FK CONSTRAINT|' "$MISSING_OBJECTS"; then
  awk -v missing="$MISSING_OBJECTS" '
    BEGIN { while ((getline l < missing) > 0) if (l ~ /^FK CONSTRAINT\|/) want[substr(l, 15)] = 1 }
    /^ALTER TABLE (ONLY )?public\./ { hdr = $0; t = $NF; sub(/^public\./, "", t); gsub(/"/, "", t); next }
    hdr != "" && /^    ADD CONSTRAINT .* FOREIGN KEY .*;$/ {
      name = $3; gsub(/"/, "", name)
      if ((t " " name) in want) { line = $0; sub(/;$/, " NOT VALID;", line); print hdr; print line }
    }
    { hdr = "" }
  ' "$POST_DATA_SQL" | $PSQL_PG -v ON_ERROR_STOP=0 >/dev/null 2>>"$RESTORE_LOG" || true
  readded=$(grep -c '^FK CONSTRAINT|' "$MISSING_OBJECTS" || true)
  list_live_objects
  readded=$((readded - $(grep -c '^FK CONSTRAINT|' "$MISSING_OBJECTS" || true)))
  if [[ "$readded" -gt 0 ]]; then
    echo "  ✓ re-added $readded foreign key(s) NOT VALID — the backup holds rows whose"
    echo "    parent rows it does not (it was not taken as one consistent snapshot)"
  fi
fi
LIVE_LEDGER=$($PSQL_PG -At -c "SELECT count(*) FROM supabase_migrations.schema_migrations" 2>/dev/null || echo 0)
expected_count=$(LC_ALL=C sort -u "$EXPECTED_OBJECTS" | wc -l | tr -d ' ')
missing_count=$(wc -l < "$MISSING_OBJECTS" | tr -d ' ')
if [[ "$expected_count" -eq 0 ]]; then
  RESTORE_UNVERIFIED=1
  echo "  ✗ found no public indexes, constraints, triggers or policies in the backup's"
  echo "    object list — the restored schema could NOT be verified"
elif [[ "$missing_count" -gt 0 ]]; then
  RESTORE_UNVERIFIED=1
  echo "  ✗ $missing_count of the backup's $expected_count public indexes/constraints/triggers/policies are MISSING:"
  head -20 "$MISSING_OBJECTS" | sed 's/^/      /'
  [[ "$missing_count" -gt 20 ]] && echo "      … and $((missing_count - 20)) more"
else
  echo "  ✓ all $expected_count public indexes, constraints, triggers and policies present"
fi
if [[ "$LIVE_LEDGER" -lt "${EXPECTED_LEDGER:-0}" ]]; then
  RESTORE_UNVERIFIED=1
  echo "  ✗ the migration ledger holds $LIVE_LEDGER of the backup's $EXPECTED_LEDGER rows —"
  echo "    applying migrations now would replay ones this schema already has"
else
  echo "  ✓ migration ledger restored ($LIVE_LEDGER rows)"
fi
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
" >/dev/null 2>"$WORK_DIR/buckets.err" || true
cat "$WORK_DIR/buckets.err" >> "$RESTORE_LOG"
# Every company needs its bucket (uploads go there), so a short count is a
# broken restore, not a number to eyeball.
BUCKET_COUNT=$($PSQL_PG -At -c "SELECT count(*) FROM storage.buckets;" 2>/dev/null || echo 0)
BUCKETS_EXPECTED=$($PSQL_PG -At -c "SELECT 5 + count(*) FROM public.company;" 2>/dev/null || echo 5)
if [[ "$BUCKET_COUNT" -ge "$BUCKETS_EXPECTED" ]]; then
  echo "  ✓ $BUCKET_COUNT storage buckets present (5 fixed + one per company)"
else
  RESTORE_UNVERIFIED=1
  echo "  ✗ $BUCKET_COUNT of $BUCKETS_EXPECTED storage buckets present — the re-seed failed:"
  grep -m 2 -E '^(ERROR|CONTEXT)' "$WORK_DIR/buckets.err" | sed 's/^/      /' || true
  # Only public is dropped, so service-schema objects a PREVIOUS restore put
  # there (before the backup's service functions were skipped) are still here.
  echo "    A storage trigger left by an earlier restore is the usual cause: drop the"
  echo "    function named above (DROP FUNCTION storage.<name> CASCADE) and re-run."
fi
# ── 3b. Localize environment-sensitive rows (RESTORE_MODE=local only) ───────
if [[ "$RESTORE_MODE" == "local" ]]; then
# The dump carries prod's singleton "config" row and Vault secrets (among them
# `inngest_event_url`, where util.send_inngest_event posts the event-queue
# doorbell), plus live webhook URLs, integration OAuth tokens, and
# printer-route ProxyBox URLs. Left as-is, the local event queue never drains
# (audit logs stay empty — the doorbell rings PROD's Inngest), and local edits
# can deliver real webhooks / Slack / Xero posts / print jobs.
echo "▶ Localizing config row + deactivating webhooks, integrations, printer routes"
ANON_KEY=$(grep '^SUPABASE_ANON_KEY=' "$REPO_ROOT/.env.local" 2>/dev/null | cut -d= -f2- || true)
if [[ -n "$ANON_KEY" ]]; then
  # Same values crbn seeds (packages/dev/src/services/migrations.ts
  # ensureConfigRow): apiUrl must be the in-network Kong URL — pg_net runs
  # inside the postgres container and can't reach host ports. An UPDATE then
  # an INSERT-if-empty rather than ON CONFLICT: the upsert needs the table's
  # primary key, and a restore that lost constraints has none.
  if $PSQL_PG -v ON_ERROR_STOP=1 -v anon_key="$ANON_KEY" <<'SQL' >/dev/null; then
UPDATE "config" SET "apiUrl" = 'http://kong:8000', "anonKey" = :'anon_key';
INSERT INTO "config" ("id", "apiUrl", "anonKey")
SELECT TRUE, 'http://kong:8000', :'anon_key'
WHERE NOT EXISTS (SELECT 1 FROM "config");
SQL
    echo "  ✓ config row → http://kong:8000 with local anon key"
  else
    echo "  ⚠ could not localize the config row — it may still point at the source"
    echo "    environment; 'crbn up' reseeds it, or update public.config by hand."
  fi
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
  -- Point the event-queue doorbell at the local Inngest dev server (as
  -- ensureConfigRow does on `crbn up` / `crbn migrate`).
  IF to_regprocedure('public.set_inngest_event_url(text)') IS NOT NULL THEN
    PERFORM public.set_inngest_event_url('http://inngest:8288/e/NO_EVENT_KEY_SET');
  END IF;
END $$;
SQL
echo "  ✓ webhooks, integrations, printer routes/jobs deactivated; vault secrets cleared; events → local Inngest"
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
# Same for a schema that did not fully land (step 3a) or missing buckets. Exiting nonzero also
# stops `crbn restore` before it applies migrations onto that schema.
if [[ -n "$RESTORE_UNVERIFIED" ]]; then
  echo "✗ The restore did not land cleanly (see the ✗ lines above)." >&2
  echo "  Localization and the email scrub DID run. Do NOT apply migrations to this" >&2
  echo "  database; check $RESTORE_LOG, then re-run this script end-to-end." >&2
  exit 1
fi
echo "✅ Done — Studio: http://127.0.0.1:$((PORT_DB+2))   (port_db+2 is the Studio port crbn assigned)"
