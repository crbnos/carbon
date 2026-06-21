# contrib

Community-contributed, optional extras for Carbon — deployment recipes, examples,
and tooling that live alongside the codebase but aren't part of the core apps.

These are reference setups: read them, copy them, adapt them to your environment.
They are not load-bearing for development (`crbn up`) or the managed cloud build.

## Deployment

| Recipe | What it does |
|---|---|
| [`deployment/simple-docker-caddy`](deployment/simple-docker-caddy) | Self-host the full stack (ERP + MES + Supabase + Redis + Inngest) on a **single Linux VPS** with a single-node **Docker Swarm** and an auto-HTTPS **Caddy** reverse proxy. Swarm secrets, host hardening, backups included. |
