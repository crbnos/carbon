#!/usr/bin/env bash
# Generate the Supabase self-host key trio for the Carbon Swarm stack.
#
#   SUPABASE_JWT_SECRET        — HMAC secret every Supabase service signs/verifies with
#   SUPABASE_ANON_KEY          — JWT(role=anon)         signed with that secret
#   SUPABASE_SERVICE_ROLE_KEY  — JWT(role=service_role) signed with that secret
#
# The anon/service_role keys MUST be signed with the printed JWT secret — the
# three are a matched set. `deploy.sh init` consumes this output to create the
# `jwt_secret`, `anon_key`, and `service_role_key` Docker secrets together.
# Re-running mints a fresh, incompatible set.
#
# Usage: ./scripts/gen-supabase-keys.sh
# Dependencies: openssl only (no Node).
set -euo pipefail

# base64url-encode stdin (binary-safe, no line wrap, no padding).
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# sign_jwt <payload-json> <secret> — print the signed HS256 JWT.
sign_jwt() {
	local payload="$1" secret="$2" header data sig
	header=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)
	data="$header.$(printf '%s' "$payload" | b64url)"
	sig=$(printf '%s' "$data" | openssl dgst -sha256 -hmac "$secret" -binary | b64url)
	printf '%s.%s' "$data" "$sig"
}

jwt_secret=$(openssl rand -hex 32) # 64 hex chars
iat=$(date +%s)
exp=$((iat + 60 * 60 * 24 * 365 * 10)) # 10 years

anon=$(sign_jwt "{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":$iat,\"exp\":$exp}" "$jwt_secret")
service=$(sign_jwt "{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":$iat,\"exp\":$exp}" "$jwt_secret")

cat <<EOF
# --- Supabase self-host keys (generated) ---
SUPABASE_JWT_SECRET=$jwt_secret
SUPABASE_ANON_KEY=$anon
SUPABASE_SERVICE_ROLE_KEY=$service
EOF
