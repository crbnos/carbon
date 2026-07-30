# Enterprise IaC Deployment → BYOC — Architecture Proposal

**Status:** draft for discussion (Sid + Brad)
**Date:** 2026-07-11
**Scope:** deploy Carbon's entire stack via IaC into a cloud account (enterprise single-tenant), evolving into a BYOC (Bring Your Own Cloud) offering.

---

## 1. What exists today

Carbon already has two production deployment paths and one accidental prototype of the enterprise architecture:

| Path | Mechanism | Data plane |
|------|-----------|-----------|
| Managed cloud | `sst.config.ts` (SST 3.17.24 / Pulumi) → ECS Fargate: `CarbonERPService` + `CarbonMESService`, ALB, WAF. Per-workspace fan-out from the Supabase `workspaces` table (`ci/src/deploy.ts`) | Supabase Cloud + external Redis + Inngest Cloud — **outside ECS entirely** |
| Self-host (community) | `contrib/deploying/simple-docker-caddy/` — Docker Swarm on one VPS: erp, mes, caddy, full Supabase stack (postgres, kong, gotrue, postgrest, realtime, storage, edge-runtime), redis, inngest | All containers on one box, EBS-equivalent volumes |
| ITAR/GovCloud (hand-rolled) | ECS apps via SST **plus** a self-hosted Supabase on an EC2 instance; edge functions synced by SSH (`.github/workflows/functions.yml` → `sync-carbon-functions.sh`) | Self-hosted Supabase on EC2 |

Key observation: **the GovCloud workspace is already the enterprise architecture** — apps on ECS, Supabase self-hosted on EC2 — just hand-rolled and un-reproducible. The enterprise IaC work is largely codifying it.

Second observation: `ci/src/deploy.ts` is already a **proto-control-plane**. It iterates customer workspaces, each with its own `aws_account_id`, region, certs, and secrets, and deploys into those accounts. BYOC is productizing this loop, not inventing it.

There is no Terraform, no Kubernetes manifests, and no BYOC spec anywhere in the repo today.

## 2. The blue/green concern (Brad)

**The premise is incorrect: ECS does not force blue/green.** The default deployment controller is a rolling update (`minimumHealthyPercent` / `maximumPercent`). Blue/green is opt-in — natively built into ECS since July 2025 (canary/linear added October 2025), replacing the old CodeDeploy integration. AWS docs: [deployment-type-blue-green](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html).

But the deeper point stands regardless of controller choice: **the database must never be an ECS service in the app-deploy blast radius.** Any zero-downtime strategy (rolling *or* blue/green, ECS *or* Swarm `start-first`) briefly runs old + new app tasks concurrently. That is fine for the app tier and catastrophic for a single-writer Postgres. The fix is tiering, not avoiding ECS:

- **Stateless tier (ECS, deploy freely):** erp, mes, geometry, gotrue, postgrest, realtime, kong, storage-api (S3-backed), edge-runtime, inngest (Postgres/Redis-backed). Two overlapping instances of any of these is safe — the managed cloud path already autoscales ERP 1→10 today.
- **Stateful tier (never in the deploy path):** Postgres, Redis, S3. Deployed once, upgraded in maintenance windows on its own lifecycle. App deploys never touch it — exactly as Supabase Cloud sits outside ECS in the managed path today.

There is never a moment with two Supabase Postgres instances, under any deployment strategy, because Postgres isn't an ECS service.

The **real** two-instances-during-deploy risk is old app code + new app code sharing one database during rollout. That is a migration-discipline problem (expand/contract: additive migrations first, destructive cleanup in a later release), and Carbon already lives with it — managed cloud runs rolling ECS deploys against a shared Supabase today. Migrations stay a separate step (today `ci/src/migrations.ts`; in the enterprise module, a one-shot ECS task run before the service update). ECS's new native blue/green is actually an argument *for* ECS here: lifecycle hooks + bake period + one-click rollback are what enterprise buyers ask for.

## 3. Constraint that shapes the data tier: Postgres extensions

Carbon migrations require: `pgcrypto`, `pg_net`, `vector`, `pg_jsonschema`, `pgmq`, `pg_trgm`, `pg_cron`, `hstore`, `uuid-ossp`.

RDS for PostgreSQL supports all of these **except `pg_net` and `pg_jsonschema`** (Supabase-maintained pgrx extensions; `pgmq` landed on RDS late 2024 — verify against current RDS extension list). Measured usage:

- `pg_net` — ~7 migrations call `net.http_post` from triggers (webhook fan-out, embeddings, job-completion hooks). Replacement: Carbon already uses `pgmq` — convert those triggers to a `pgmq.send()` outbox consumed by the existing queue worker, which does the HTTP call. Bounded, ~8 SQL sites.
- `pg_jsonschema` — 4 migrations validate integration/calibration metadata in triggers; zod already validates the same payloads app-side. Drop the DB check or replace with plpgsql.

**Extensions are only half the RDS gap — the other half is the privilege/bootstrap surface.** The `supabase/postgres` image's initdb creates the service roles (`supabase_admin` — a true superuser in the image — `supabase_auth_admin`, `supabase_storage_admin`, `authenticator`, `anon`/`authenticated`/`service_role`), the `auth`/`storage`/`realtime`/`extensions` schemas, the `auth.uid()`/`auth.jwt()` helper functions, default grants, and the `supabase_realtime` publication. `contrib/.../postgres/01-roles.sh` only sets passwords on roles the image already made. On RDS all of it must be hand-bootstrapped before migration #1 (86 migration files call `auth.uid()`/`auth.jwt()`).

Superuser itself is not a wall, though — Carbon already runs without it in production: Supabase Cloud grants no true superuser, and the code is built for that (`company-import.ts` probes `canSetReplicationRole()` and falls back to triggers-on import when `session_replication_role` is denied). Verified absent from Carbon SQL: `EVENT TRIGGER`, `pgsodium`/vault, `ALTER SYSTEM`, `CREATE PUBLICATION` (only owner-level `ALTER PUBLICATION ... ADD TABLE`). Remaining vanilla-superuser ops all have RDS-blessed equivalents: extensions via `rds_superuser`, Realtime's replication via a `rds_replication` grant, publication ownership via the bootstrap role.

**Recommendation: run the "RDS compatibility pack" as a phase-1 workstream** — (1) the extension swap above, (2) a bootstrap SQL pack ported from the image init scripts (roles minus SUPERUSER, schemas, auth helpers, grants, publication), (3) a proving run against a scratch RDS instance: GoTrue/Storage/Realtime service migrations apply, Carbon migrations apply, a realtime slot streams, the restore fallback engages. ~2–3 weeks. It unlocks RDS Multi-AZ / Aurora / Cloud SQL / CloudNativePG — the boxes enterprise procurement actually checks. Until it lands (or if the proving run hits a real wall), v1 runs the `supabase/postgres` image on EC2 + EBS (snapshots + `pg_dump` to S3; the Swarm backup script already does the pg_dump half).

**"Should we just move off Supabase to plain Postgres?" — considered, rejected.** The image is the only Supabase piece that binds the database. The service containers (GoTrue, PostgREST, Realtime, Storage) are ordinary Postgres clients and run against any Postgres given the role bootstrap (Swarm's `postgres/01-roles.sh` already exists) and `wal_level=logical` for Realtime (RDS supports it). Exiting Supabase-the-architecture is a different beast entirely — thousands of supabase-js/PostgREST call sites across every service file, `packages/auth` built on GoTrue + JWT-keyed RLS, 10+ Realtime consumers, 7 storage buckets, ~35 Deno edge functions — a year-plus platform rewrite whose end state is rebuilding auth/realtime/storage/REST in-house. The extension audit buys the entire cloud-database benefit without it.

## 4. Recommended architecture (v1: Terraform module, AWS)

One **Terraform module** (`terraform-aws-carbon`), single-tenant, deployed into the customer's (or our) AWS account. Same container images as today — the root `Dockerfile` and the Supabase/Inngest/Redis images from the Swarm compose are reused verbatim; the Swarm compose is the topology spec.

**Why Terraform and not SST/Pulumi or Helm:**
- BYOC customers' platform teams run Terraform/OpenTofu; they will not run our Pulumi app or adopt SST. Terraform is the lingua franca of the "here, deploy this in your account" motion (Airbyte, Redpanda, Confluent all ship it).
- SST stays for the managed multi-tenant cloud — no migration needed; the two paths share images, not IaC.
- EKS/Helm is more portable (GKE/AKS) but triples the ops burden (cluster lifecycle, upgrades) for a stack that is ~10 containers — wrong starting point, but it IS the committed Phase 3 BYOC direction via a custom operator (see §5). Phase 1 takes the portability hedges listed there so the operator route stays cheap.

**Module layout:**

```
network      VPC, subnets, NAT, SGs (or accept existing VPC IDs — enterprises often mandate their own)
data         RDS for Postgres Multi-AZ (requires the §3 extension audit; fallback if it slips: EC2 + EBS running supabase/postgres), ElastiCache Redis, S3 buckets (storage backend + backups)
supabase     ECS services: kong, gotrue, postgrest, realtime, storage-api (STORAGE_BACKEND=s3), edge-runtime
apps         ECS services: erp, mes, geometry(-rs); ALB, target groups, /health checks, WAF (assoc automated, unlike sst.config.ts)
jobs         ECS service: inngest (INNGEST_POSTGRES_URI → data-tier Postgres, INNGEST_REDIS_URI → ElastiCache; plain-hex keys quirk)
migrate      one-shot ECS task definition: supabase db push + seed (invoked per release, before app service update)
secrets      AWS Secrets Manager entries for the full env matrix (the `workspaces`-table columns become module inputs)
dns/certs    optional Route53 + ACM (accept external cert ARNs — mirrors current per-workspace cert model)
```

Notes:
- ECS is not stateless-only (it supports EFS and EBS task volumes), but a singleton single-writer Postgres is still the wrong fit — ECS has no stable volume/identity semantics for a database (no StatefulSet equivalent). Every other Supabase component keeps its state in Postgres or S3, which is what makes it ECS-safe: gotrue, postgrest, kong (DB-less declarative config), storage-api (with S3 backend), edge-runtime are all freely scalable. Supabase Cloud itself runs each project's Postgres on a dedicated VM with the surrounding services managed separately — same split.
- **Realtime caveat:** run at `desired_count = 1` with a no-overlap deploy (`deployment_maximum_percent = 100`, `deployment_minimum_healthy_percent = 0`). It consumes a Postgres replication slot; two concurrent instances (rolling overlap) would contend on the slot. Multi-node Realtime clustering exists but is not worth the complexity for v1 — a seconds-long blip in UI liveness during deploys is acceptable.
- Storage must switch from the Swarm's `STORAGE_BACKEND: file` to `s3` — storage-api supports it natively; this is what makes storage-api stateless and ECS-safe.
- Edge functions: stop the SSH-rsync model. Bake `packages/database/supabase/functions/` into a versioned `edge-runtime` image at release time; deploying the new image *is* the function deploy. Kills `functions.yml`'s SSH step for enterprise installs.
- App-tier deployment strategy: rolling by default; native blue/green + bake period as an input for customers who want it. Neither touches the data tier.
- `CARBON_EDITION=enterprise` + the offline Ed25519 license key are module inputs — this is the EE gate for BYOC (ties into the edition-license enforcement work).

## 4b. v1 posture — the minimal-code-change path (decided direction)

Keep every Supabase component whose removal costs app-code rewrites; change only what the enterprise goal forces. GoTrue, PostgREST, Realtime, Storage API, Kong, and edge-runtime all stay — they are stateless containers, cheap to run, expensive to exit. The full code bill for v1:

| Change | Why required | Size |
|--------|-------------|------|
| RDS compatibility pack: `pg_net` → `pgmq` outbox (~8 SQL sites), `pg_jsonschema` → drop (4 migrations), bootstrap SQL (roles/schemas/auth helpers/publication ported from image init), scratch-RDS proving run | unlocks RDS/Aurora — extensions AND privilege surface (see §3) | 2–3 weeks |
| Route `carbon/send-email` + `resend.server.ts` through the EE Email provider (SMTP) | enterprise email | 1–2 days |
| Make `POSTHOG_*` optional at boot | ITAR/air-gap egress | 1 day |
| Default the `VERCEL_URL` shim | cosmetic boot requirement | hours |
| Bake edge functions into a versioned edge-runtime image | replaces SSH sync; Dockerfile only | 1 day |
| `STORAGE_BACKEND=s3` | config only | 0 |

≈3–4 weeks of code total (the RDS pack dominates); everything else is Terraform. With the RDS compatibility pack landed, **v1's data tier is RDS Multi-AZ from day one** — the EC2 + EBS Postgres box drops out of the architecture (GoTrue/Realtime/Storage run fine against RDS given the roles bootstrap, adapted from `postgres/01-roles.sh`, and `rds.logical_replication=1`).

Consciously accepted costs of keeping the code untouched: the Realtime singleton (no-overlap deploys, seconds of liveness blip per release), the Kong hop and third public hostname (ALB path-routing could replace Kong later — zero app code either way), per-release edge-runtime image baking, and ~11 operator-managed workloads in Phase 3 instead of ~5. The incremental Supabase-shrink ladder (edge functions → Node first, then Realtime → Redis pubsub, Storage → presigned S3, PostgREST → Kysely, GoTrue last) remains available as pure-optional simplification — each completed rung deletes deployment surface, none blocks any phase.

## 5. Path to BYOC

**Phase 1 — Enterprise Terraform module (the above).** We run it ourselves for ITAR/enterprise deals; replaces the hand-rolled GovCloud setup. Deliverables: module repo, versioned releases, runbook.

**Phase 2 — Distribution.** Customers can run Phase 1 themselves:
- Public versioned images (GHCR or public ECR) — today CI pushes only to our private ECR, so customers can't pull. Release = image set (erp, mes, geometry, edge-runtime+functions) + migration bundle + module version, tagged together.
- Semver releases with tested upgrade paths (`terraform apply` + migrate task), expand/contract migration policy documented.
- License key activates EE features offline (Ed25519 verification already built).

**Phase 3 — BYOC proper: Kubernetes operator in the customer's cluster (decided direction, deliberately deferred).** A custom operator (kubebuilder/controller-runtime) deployed into the customer's EKS/GKE/AKS cluster, reconciling a `CarbonInstall` CRD (`version`, `edition`, `licenseKey`, sizing, feature flags). The operator pulls release artifacts from our registry and owns: upgrade orchestration (pause → migration `Job` → progressive rollout → health gates → report), drift correction, and a license/health telemetry heartbeat back to Carbon's management plane. Pull-model, no inbound vendor access — the shape that clears enterprise security review (ClickHouse BYOC / Redpanda / CloudNativePG precedent). This also makes BYOC cloud-agnostic: the operator doesn't care whose managed K8s it runs on.

What the operator route costs (why it's phase 3, not phase 1): operator engineering is a real product (CRD design, upgrade state machine, testing across K8s versions/distros), we inherit customer-cluster variance (PSS, OPA policies, meshes, version skew), and the repo has zero K8s today while ECS/SST expertise and a running GovCloud precedent exist. Phases 1–2 fund and de-risk it.

**Hedges to take in Phase 1 so the operator route stays cheap later:**
1. One versioned release artifact set (app images + edge-runtime image + migration bundle, tagged together) — the operator consumes exactly the same artifacts as Terraform.
2. Migration runs as a plain container entrypoint — works as an ECS one-shot task today, a K8s `Job` later.
3. All runtime config via env vars only (already true — 12-factor); no ECS-specific APIs in app code; service discovery stays env-driven URLs, never hardcoded Service Connect names.
4. Terraform module boundaries (`data` / `supabase` / `apps` / `jobs` / `migrate`) mirror the future Helm chart / operator-managed component layout.
5. Build the vendor-side management plane (release channels, license issuance, telemetry ingest) transport-agnostic — it serves CI-driven ECS installs now and operator heartbeats later. This is `ci/src/deploy.ts`'s workspace loop productized.

Open question parked with the operator work: in-cluster Postgres (CloudNativePG operator gives StatefulSet identity, backups, PITR, failover) vs keeping the data tier on EC2/RDS outside the cluster even in the EKS world. Not blocking — decide when phase 3 starts.

Phasing matters: Phase 1 is sellable on its own ("we deploy Carbon in your account"), and each phase de-risks the next.

## 5b. Support-access plane (NetBird) — vendor-operated connectivity

Decided 2026-07-18: BYOC deployments are **vendor-operated** ("Model B") — Carbon runs upgrades and carries the pager; the customer owns the account and the data. That requires a support-access path into customer VPCs that survives enterprise security review, without ever making the overlay an app dependency.

**Control plane.** Decided 2026-07-18: **NetBird Cloud** (managed), not self-hosted. Rationale: zero control-plane ops while the team is small, and the cloud-only MSP feature is purpose-built for the Model B shape — multiple customer networks under one account with per-tenant switching. The data plane is end-to-end encrypted WireGuard either way; NetBird's cloud sees coordination metadata (peers, topology, connection events), never traffic. **Customers are never NetBird users** — they only contribute *peers* via setup keys; the only humans in the system are Carbon engineers. Delete the default allow-all policy on day one; every policy explicit. Escape hatches, kept open by NetBird being open source (BSD-3): a sovereignty-demanding deal runs `supportAccess: disabled` (SSM-only support), and a later wholesale move to a self-hosted control plane is re-registering peers, not a redesign. The ITAR/GovCloud install should be treated as supportAccess-disabled from day one — a third-party control plane holding connection metadata is unlikely to clear ITAR review; SSM is the support path there.

**Customer side (part of the artifact set).** Two NetBird routing-peer containers (agent, `NET_ADMIN`) — an ECS service in phase 1, an operator-managed Deployment in phase 3 — registered with a per-customer setup key minted by the Carbon control plane. They advertise only the app subnets (or narrower resources), masquerade on, and dial **out** on 443 to the NetBird endpoints (documented in the egress allowlist alongside registry + telemetry). Security groups add a second gate: routing-peer SG → specific ports only. `CarbonInstall.supportAccess: enabled|disabled` scales the peers to zero — the customer's kill switch. ITAR/air-gap installs run permanently disabled; nothing in the stack depends on the overlay. SSM Session Manager via a customer-granted narrow IAM role remains the AWS-native parallel path for shell access; NetBird provides network reach (internal ALBs, DB, dashboards). Both audited.

**Isolation model.** Per customer: a NetBird Network (v0.35+) with their VPC subnets as resources — resources are invisible to any peer until a policy explicitly grants access (zero-trust default; legacy network routes bypass ACLs unless configured, so use Networks, not routes). Groups: `eng-oncall`, plus a per-customer `access-{customer}` group used as both policy source and route-distribution group. No standing memberships.

**Access workflow (time-boxed).**
1. Engineer requests access to an install in the fleet dashboard (incident/ticket reference).
2. Approval → control plane calls the NetBird API: adds the engineer to `access-{customer}` with a TTL.
3. Routes and policy propagate in seconds; engineer reaches the internal ALB / observability endpoints over p2p WireGuard (Carbon-hosted relay as fallback).
4. TTL expiry removes the membership; routes vanish. NetBird activity events are the audit trail; streaming into the customer's SIEM is a later enterprise option.

**Overlapping CIDRs.** Customer VPC ranges will collide (10.0.0.0/16 is everyone's default). Routes are only distributed while a grant is active, so serial access is conflict-free; simultaneous overlapping grants fall back to client-side route selection (client ≥ 0.27.4). Transparent remapping is an open upstream feature (netbird#4664) — don't design around it. Bootstrap docs should nudge customers toward distinct CIDRs when they have flexibility.

**Failure surface.** If the NetBird control plane is down: established tunnels keep working, new grants fail, and the customer stack is unaffected (the overlay is never in the app path). Run management with a Postgres backend, 2 tasks, backups. Setup keys revoke per customer (blocks new registrations); existing peers removable via API.

**Dogfood path.** Carbon's own staging/prod accounts are customers #0 and #1 of this exact pattern (`access-staging`, `access-prod`). The GovCloud install's SSH access migrates to routing peer + SSM once edge-function baking lands (§4b already kills the SSH sync).

## 6. Gaps to close (found in the audit)

| Gap | Detail | Severity for BYOC |
|-----|--------|-------------------|
| `pg_net` + `pg_jsonschema` | Block RDS/Aurora; force EC2 data tier | Medium — EC2 works, RDS is better optics |
| SMTP send-path wiring | SMTP is already supported in concept: GoTrue sends auth mail via `GOTRUE_SMTP_*` (wired in Swarm compose), and the EE Email integration (`packages/ee/src/email/config.tsx`) has a `resend \| smtp` provider with a nodemailer healthcheck. Remaining work: the `carbon/send-email` Inngest function and `packages/lib/src/resend.server.ts` still send via Resend only — route them through the configured SMTP provider for enterprise installs (boot still wants a placeholder `RESEND_API_KEY`) | Low (wiring, not architecture) |
| PostHog required at boot | `POSTHOG_*` required env — external analytics egress mandatory. Must become optional (or self-hosted PostHog input) for enterprise/ITAR | High |
| `VERCEL_URL` shim | Required at module load, meaningless off-Vercel. Cosmetic but embarrassing in a customer-run install — rename/default it | Low |
| Geometry service | No implemented prod deploy (draft spec only, Rust rewrite in flight, CI builds but doesn't push). Must be a first-class service in the module | Medium |
| AI egress | Anthropic/OpenAI keys; `AI_BASE_URL` override exists — document Bedrock/self-hosted model path for enterprise | Medium |
| Edge function sync | SSH-rsync (`functions.yml`) doesn't scale past one instance — replaced by baked images (§4) | High (fixed by design) |
| academy / docs / starter | Outside all tracked prod IaC — assumed out of scope for enterprise deployments; confirm | Low |

## 7. Open questions for Brad

1. ~~Data-tier ambition~~ — resolved: the extension audit is a phase-1 prerequisite; v1 ships on RDS Multi-AZ (§4b). EC2 + EBS remains only as the fallback if the audit slips a deal timeline.
2. ~~Who operates Phase 1 deployments~~ — resolved (2026-07-18): **vendor-operated ("Model B")** — Carbon operates installs in the customer's account; support access via the self-hosted NetBird plane (§5b) + optional customer-granted SSM role.
3. Does any near-term deal require non-AWS (Azure/GCP)? If yes, that pulls the Helm-chart question forward; if no, AWS-only v1.
4. Blue/green for the app tier: adopt native ECS blue/green with bake/rollback as the default enterprise strategy, or keep plain rolling (current SST behavior)?
5. Is Inngest self-hosted (already proven in Swarm) the standard for enterprise, or does any deal tolerate Inngest Cloud egress?

## Sources

- ECS blue/green (built-in, July 2025): https://aws.amazon.com/blogs/aws/accelerate-safe-software-releases-with-new-built-in-blue-green-deployments-in-amazon-ecs/ ; https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-blue-green.html ; https://www.infoq.com/news/2025/07/aws-blue-green-ecs/
- Inngest self-hosting (external Postgres/Redis): https://www.inngest.com/docs/self-hosting
- NetBird Networks / routing peers (zero-trust resource visibility): https://docs.netbird.io/manage/networks/how-routing-peers-work
- NetBird overlapping routes (client-side selection): https://docs.netbird.io/manage/network-routes/overlapping-routes ; transparent remap upstream: https://github.com/netbirdio/netbird/issues/4664
- NetBird self-hosted vs cloud (single-account mode; MSP is cloud-only): https://docs.netbird.io/about-netbird/self-hosted-vs-cloud ; https://forum.netbird.io/t/multi-tenant-question-regarding-users-with-the-same-email-domain/410
- In-repo: `sst.config.ts`, `ci/src/deploy.ts`, `ci/src/migrations.ts`, `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml`, `.github/workflows/{deploy,supabase,functions,inngest}.yml`, `packages/env/src/index.ts`, extension grep over `packages/database/supabase/migrations/`
