#!/bin/sh
# Carbon — Docker Swarm secrets shim.
#
# Docker Swarm delivers secrets as files under /run/secrets/<name>, but the
# Supabase images (and the Carbon apps) only read configuration from environment
# variables — several of them Postgres connection strings that *embed* the
# password. This shim bridges the two: for every environment variable whose value
# contains a `__SECRET_NAME__` placeholder, it substitutes the literal contents of
# the matching /run/secrets/<secret_name> file, then exec()s the original
# container command unchanged.
#
# Example:
#   secret file : /run/secrets/postgres_password   -> "s3cr3t"
#   env in stack: PGRST_DB_URI=postgres://authenticator:__POSTGRES_PASSWORD__@postgres:5432/postgres
#   env at exec : PGRST_DB_URI=postgres://authenticator:s3cr3t@postgres:5432/postgres
#
# Placeholder = the secret's file name, upper-cased, wrapped in double underscores
# (`postgres_password` -> `__POSTGRES_PASSWORD__`). Substitution is *literal*
# (awk index/substr, not regex), so secret values may safely contain / + = & \ etc.
# Assumption: secret values are single-line (everything deploy.sh generates is).
#
# Used as `entrypoint:` on every service that consumes a secret. POSIX sh + awk
# only — verified present in all pinned images.
set -eu

SECRETS_DIR="${CARBON_SECRETS_DIR:-/run/secrets}"

if [ -d "$SECRETS_DIR" ]; then
  # Emit `export NAME='value'` lines for each env var that had a placeholder
  # resolved, then eval them into this shell before exec.
  eval "$(
    awk -v dir="$SECRETS_DIR" '
      function shquote(s,   q) { q = sprintf("%c", 39); gsub(q, q "\\" q q, s); return q s q }
      BEGIN {
        # Load secrets: UPPER_CASE(filename) -> first line of file.
        cmd = "ls -1 " dir " 2>/dev/null"
        while ((cmd | getline fn) > 0) {
          path = dir "/" fn
          val = ""
          if ((getline line < path) > 0) val = line
          close(path)
          key = toupper(fn)
          gsub(/[^A-Z0-9_]/, "_", key)
          secret[key] = val
        }
        close(cmd)

        # Substitute __KEY__ placeholders in every environment variable.
        for (name in ENVIRON) {
          v = ENVIRON[name]
          if (v !~ /__[A-Z0-9_]+__/) continue
          out = ""; rest = v
          while (match(rest, /__[A-Z0-9_]+__/)) {
            ph  = substr(rest, RSTART, RLENGTH)
            k   = substr(ph, 3, length(ph) - 4)
            rep = (k in secret) ? secret[k] : ph
            out = out substr(rest, 1, RSTART - 1) rep
            rest = substr(rest, RSTART + RLENGTH)
          }
          print "export " name "=" shquote(out rest)
        }
      }
    '
  )"
fi

exec "$@"
