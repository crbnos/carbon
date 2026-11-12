# Carbon on a single VPS — Docker Swarm + Caddy

Self-host the full Carbon stack (ERP + MES + Supabase + Redis + Inngest) on **one
Linux VPS** as a single-node [Docker Swarm](https://docs.docker.com/engine/swarm/)
behind an automatic-HTTPS [Caddy](https://caddyserver.com/docs/) reverse proxy.
Secrets are real Docker Swarm secrets; only ports 80/443 are exposed.

## 📖 Full guide → [docs.carbon.ms/docs/platform/self-hosting/docker-caddy](https://docs.carbon.ms/docs/platform/self-hosting/docker-caddy)

Prerequisites, step-by-step install, how secrets work, operations, and the
production checklist all live in the docs. Quick version:

```bash
sudo ./scripts/harden.sh    # firewall, fail2ban, swap (optional, recommended)
./deploy.sh init            # swarm init + generate Docker secrets + .env
$EDITOR .env                # hosts, URLs, ACME email, SMTP
./deploy.sh up              # build + deploy + migrate
./deploy.sh status
```

## Files

| File | Purpose |
|---|---|
| `docker-compose.prod.yml` | The Swarm stack (all services, secrets, volumes, overlay network). |
| `deploy.sh` | Lifecycle: `init` / `build` / `deploy` / `up` / `migrate` / `secret` / `status` / `logs` / `down`. |
| `supavisor/pooler.exs` | Seeds Supavisor's tenant on boot (from BYOC). |
| `envoy/` | The API gateway's config (from BYOC). |
| `Caddyfile` | Reverse proxy: erp/mes/api + security headers; optional Studio behind basic-auth. |
| `bin/secrets-entrypoint.sh` | Injects Swarm secrets into env (`__SECRET__` placeholders) for each service. |
| `postgres/01-roles.sh` | Supabase role bootstrap. |
| `postgres/02-performance.sh` | Postgres tuning + `pg_stat_statements`. |
| `scripts/gen-supabase-keys.sh` | Generates the Supabase JWT key trio (openssl only). |
| `scripts/harden.sh` | Host hardening (UFW, fail2ban, swap, unattended-upgrades). |
| `scripts/backup.sh` | Postgres dump + storage volume archive. |
| `.env.example` | Non-secret configuration template. |

## Upgrade to Postgres 17

The stack runs `supabase/postgres:17`. `./deploy.sh deploy` stops if the
`<stack>_pgdata` volume holds data from Postgres 15. Move the data with a dump
and restore, with the old stack still running for step 1:

```bash
./scripts/backup.sh                                   # 1. dump the database
set -a; . ./.env; set +a                              # STACK_NAME comes from .env
docker stack rm "$STACK_NAME"                         # 2. stop the stack
while docker ps -q --filter "label=com.docker.stack.namespace=$STACK_NAME" | grep -q .; do sleep 2; done
docker volume rm "${STACK_NAME}_pgdata" "${STACK_NAME}_pgconfig"   # only Postgres's volumes
git pull && ./deploy.sh init && ./deploy.sh build && ./deploy.sh deploy   # 3. new stack, empty Postgres 17
gunzip -c backups/carbon-<timestamp>/db.sql.gz \
  | docker exec -i "$(docker ps -qf name=${STACK_NAME}_postgres.1)" psql -U supabase_admin postgres
./deploy.sh migrate                                   # 4. migrations the dump predates
```

`init` only creates the secrets the stack is missing (here Supavisor's two).

Restore as `supabase_admin`: `postgres` may not change the auth and storage
schemas. The restore reports "already exists" errors for the auth, storage and
realtime schemas, which their services create on boot; the rows still load.
The storage volume is not touched.

