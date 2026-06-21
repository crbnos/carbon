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
| `stack.yml` | The Swarm stack (all services, secrets, volumes, overlay network). |
| `deploy.sh` | Lifecycle: `init` / `build` / `deploy` / `up` / `migrate` / `secret` / `status` / `logs` / `down`. |
| `Caddyfile` | Reverse proxy: erp/mes/api + security headers; optional Studio behind basic-auth. |
| `bin/secrets-entrypoint.sh` | Injects Swarm secrets into env (`__SECRET__` placeholders) for each service. |
| `postgres/01-roles.sh` | Supabase role bootstrap. |
| `postgres/02-performance.sh` | Postgres tuning + `pg_stat_statements`. |
| `scripts/gen-supabase-keys.mjs` | Generates the Supabase JWT key trio. |
| `scripts/harden.sh` | Host hardening (UFW, fail2ban, swap, unattended-upgrades). |
| `scripts/backup.sh` | Postgres dump + storage volume archive. |
| `.env.example` | Non-secret configuration template. |
