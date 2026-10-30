# Feature run: Workload identity federation for the Carbon API

- Date: 2026-10-30
- Mode: fully-autonomous
- Request: "can we also have identity federation like claude?" (screenshot of the Claude Console modal: "With identity federation, you don't need an API key"), then `/feature`.
- Phase plan: research [run — auth design with no Carbon precedent] · spec [run — new table, token endpoint, auth change, new UI] · plan [run] · execute [run] · test [run — new settings UI] · self-review [run]

## Decisions
- Scope: Cloud first. Public OIDC issuers (GitHub Actions, GCP, Azure, AWS). Self-host gets a configurable audience and an install setting that permits private issuers. No pasted signing keys for air-gapped installs. — The user did not answer the scope question. Earlier in the conversation we agreed that self-hosters gain the least, and that pasted keys bring back the manual rotation work. — 2026-10-30

- Spec gate: every non-Ask-First question resolved autonomously; the spec's Open Questions section lists them, marked **Autonomous**. — Ask-First questions went to the user in one round, as the spec-writing skill requires even in autonomous mode. — 2026-10-30

- Plan gate: plan approved autonomously. — The user said "take the ownership and don't ask me for anything, stop when it's done". — 2026-10-30

## Phase log
- research: done — `.ai/research/workload-identity-federation.md`. 4 subagents: API platforms, package registries, cloud IAM with SAP, and a map of the Carbon API-key code. STE-80 pass done.
- spec: done — `.ai/specs/2026-10-30-workload-identity-federation.md`. The user answered the 3 Ask-First questions (token storage, endpoint, acting identity), all with the recommended option. STE-80 pass done.

- plan: done — `.ai/plans/2026-10-30-workload-identity-federation.md`, 10 tasks. STE-80 pass done.

- execute: done — 10 tasks, 17 commits. A test-first proof (scratch, not committed) minted a key with a locally signed JWT and checked 7 cases: in-scope 200, out-of-scope 403, replay, other owner id, other repo, other audience. The browser checks covered create, validation, the private-issuer refusal, narrowing scopes (live key 200 → 403), delete (live key → 401), and expiry (→ 401).
- test: done — browser flows above. Screenshots in `.context/`.
- self-review: done — 2 must-fix items (direct PostgREST writes to `federationRule`; a false single-use claim in the docs) and 3 cheap risks fixed in `fix(federation): close the review's security findings`. Open risks are listed in the final hand-off.
- STE-80 pass done on research, spec, plan and this run record.

## Outcome
- Built and committed locally on `naveenkash/identity-federation-like-claude` (Conductor renamed the branch from `naveenkash/rinw9` during the run). Not pushed, no PR, as the user asked.

## 2026-10-31: Claude Console parity
- Scope (user): everything on the Console screens except service accounts and CEL conditions.
- Built: `federationIssuer` (key source, CA certificate, single-use toggle, token-age limit), `federationExchange` (authentication events, 30 days), archive in place of delete, Rules / Issuers / Authentication events tabs, the Connect workload wizard with a Test step, the Kubernetes preset, rule descriptions and slug names, and a key lifetime capped at twice what the token has left.
- Checks: ee tests (74) and typecheck, erp / database / jobs / lib typecheck, `@carbon/checks` (406), authz tests and `authz check` (no drift), `@carbon/content` links, Biome, `db:check:backups`, `db:check:datasets` (5 of 5).
- End-to-end proof (scratch script, not committed): an Inline JWKS issuer and a rule inserted for the dev company; a signed token exchanged at `/token` returned a key with `expires_in` 599 (token had 300 s left), and the key called `POST /api/v1/sales/getCustomers` (200). A replayed token, another subject, a token with no `jti` and a token after the rule was archived each answered 400; the events read `jti_reused`, `subject_mismatch`, `missing_jti` and `rule_archived`. Scratch rows deleted.
