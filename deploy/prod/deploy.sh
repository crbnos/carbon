#!/usr/bin/env bash
#
# Carbon production deploy helper.
#
# Wraps the self-hosted docker-compose stack: generates the env file (with the
# Supabase key trio + random secrets) and brings the stack up in the correct
# order (postgres+storage -> migrate -> rest -> apps). See deploy/prod/README.md.
#
# Usage:
#   deploy/prod/deploy.sh init [--force]   # create .env.production from template
#   deploy/prod/deploy.sh up               # build + boot the full stack
#   deploy/prod/deploy.sh migrate          # (re)apply DB migrations only
#   deploy/prod/deploy.sh down [--volumes] # stop the stack
#   deploy/prod/deploy.sh status           # docker compose ps
#   deploy/prod/deploy.sh logs [service]   # follow logs
#
set -euo pipefail

readonly SCRIPT_NAME=$(basename "$0")
readonly ROOT=$(cd "$(dirname "$0")/../.." && pwd)
readonly COMPOSE_FILE="docker-compose.prod.yml"
readonly ENV_FILE=".env.production"
readonly ENV_EXAMPLE=".env.production.example"

# ── output ───────────────────────────────────────────────────────────────────
log()  { printf '\033[0;36m[%s]\033[0m %s\n' "$(date '+%H:%M:%S')" "$*"; }
warn() { printf '\033[0;33m[warn]\033[0m %s\n' "$*" >&2; }
error() { printf '\033[0;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# ── compose wrapper (always run from repo root, with the env file) ────────────
dc() { (cd "$ROOT" && docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"); }

usage() {
	sed -n '3,16p' "$0" | sed 's/^# \{0,1\}//'
	exit "${1:-0}"
}

require_cmds() {
	local missing=()
	for c in "$@"; do command -v "$c" >/dev/null 2>&1 || missing+=("$c"); done
	[ ${#missing[@]} -eq 0 ] || error "missing required command(s): ${missing[*]}"
}

require_env_file() {
	[ -f "$ROOT/$ENV_FILE" ] || error "$ENV_FILE not found — run '$SCRIPT_NAME init' first"
}

# Set or replace KEY=VALUE in the env file (portable: awk + temp file, no
# in-place sed flag differences across GNU/BSD). VALUE is written verbatim.
upsert_env() {
	local key=$1 val=$2 file="$ROOT/$ENV_FILE" tmp
	tmp=$(mktemp)
	if grep -q "^${key}=" "$file"; then
		awk -v k="$key" -v v="$val" '
			$0 ~ "^" k "=" { print k "=" v; done=1; next }
			{ print }
		' "$file" >"$tmp"
	else
		cp "$file" "$tmp"
		printf '%s=%s\n' "$key" "$val" >>"$tmp"
	fi
	mv "$tmp" "$file"
}

# ── commands ──────────────────────────────────────────────────────────────────
cmd_init() {
	require_cmds node openssl
	local force=0
	[ "${1:-}" = "--force" ] && force=1

	if [ -f "$ROOT/$ENV_FILE" ] && [ "$force" -ne 1 ]; then
		error "$ENV_FILE already exists (pass --force to overwrite)"
	fi
	[ -f "$ROOT/$ENV_EXAMPLE" ] || error "$ENV_EXAMPLE missing"

	log "Creating $ENV_FILE from template"
	cp "$ROOT/$ENV_EXAMPLE" "$ROOT/$ENV_FILE"

	log "Generating Supabase key trio"
	# gen-supabase-keys.mjs prints KEY=VALUE lines (jwt secret, anon, service).
	while IFS='=' read -r k v; do
		case "$k" in
			SUPABASE_JWT_SECRET|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)
				upsert_env "$k" "$v" ;;
		esac
	done < <(node "$ROOT/scripts/gen-supabase-keys.mjs")

	log "Generating random secrets"
	local pg_pass session inngest_sign inngest_event
	pg_pass=$(openssl rand -hex 24)
	session=$(openssl rand -hex 32)
	inngest_sign=$(openssl rand -hex 32)   # plain hex — inngest server rejects signkey- prefix
	inngest_event=$(openssl rand -hex 16)

	upsert_env POSTGRES_PASSWORD "$pg_pass"
	upsert_env SESSION_SECRET "$session"
	upsert_env INNGEST_SIGNING_KEY "$inngest_sign"
	upsert_env INNGEST_EVENT_KEY "$inngest_event"
	# Self-host postgres has no TLS; password must match POSTGRES_PASSWORD.
	upsert_env SUPABASE_DB_URL "postgresql://postgres:${pg_pass}@postgres:5432/postgres?sslmode=disable"

	log "$ENV_FILE created."
	warn "Before 'up', edit $ENV_FILE and set:"
	warn "  ERP_HOST / MES_HOST / SUPABASE_HOST + matching *_URL + ACME_EMAIL"
	warn "  RESEND_API_KEY (ERP fails to boot if empty — use a real key or placeholder)"
	warn "  GOTRUE_SMTP_* (so Auth can send invites / magic links)"
}

cmd_up() {
	require_cmds docker
	require_env_file

	log "Building app images (erp, mes)"
	dc build erp mes

	log "Starting postgres + storage (waiting for healthy)"
	dc --profile data up -d --wait postgres storage

	log "Applying database migrations"
	dc --profile data run --rm migrate

	log "Starting remaining data-plane services"
	dc --profile data up -d \
		gotrue postgrest realtime meta studio kong edge-runtime redis inngest

	log "Starting apps + reverse proxy"
	dc up -d erp mes caddy

	log "Stack up. Check status: $SCRIPT_NAME status"
}

cmd_migrate() {
	require_cmds docker
	require_env_file
	dc --profile data up -d --wait postgres storage
	dc --profile data run --rm migrate
}

cmd_down() {
	require_cmds docker
	require_env_file
	if [ "${1:-}" = "--volumes" ]; then
		warn "Tearing down stack AND deleting volumes (data loss)"
		dc --profile data down -v --remove-orphans
	else
		dc --profile data down
	fi
}

cmd_status() { require_env_file; dc --profile data ps; }
cmd_logs()   { require_env_file; dc --profile data logs -f "${@:-}"; }

# ── dispatch ──────────────────────────────────────────────────────────────────
main() {
	local sub="${1:-}"
	[ $# -gt 0 ] && shift || true
	case "$sub" in
		init)    cmd_init "$@" ;;
		up)      cmd_up "$@" ;;
		migrate) cmd_migrate "$@" ;;
		down)    cmd_down "$@" ;;
		status)  cmd_status "$@" ;;
		logs)    cmd_logs "$@" ;;
		-h|--help|help|"") usage 0 ;;
		*) error "unknown command: $sub (try '$SCRIPT_NAME --help')" ;;
	esac
}

main "$@"
