# Feature run: SCIM 2.0 provisioning

- Date: 2026-10-30
- Mode: fully-autonomous (switched from approval-per-phase at the user's request during research: "you take the ownership and dont ask me for anything, stop when it's done")
- Request: "SCIM 2.0 provisioning for Carbon. Let a customer's IdP (Okta, Entra ID) create, update, deactivate and regroup Carbon employees automatically over SCIM 2.0 (RFC 7643/7644). The main outcome is automatic offboarding: a person disabled in the IdP loses access to the company in Carbon, and their sessions end." (Full brief in the session: closest sibling SAML SSO, hashed-token pattern from API keys, research topics, known constraints, 7 open questions.)
- Phase plan: research [run — the user asked for it; IdP behavior is external fact] · spec [run — data model, auth/RBAC, open questions] · plan [run] · execute [run] · test [run — the Settings → SSO Provisioning section is user-facing] · self-review [run]
- Closest sibling: SAML SSO (`.ai/specs/2026-08-21-enterprise-saml-sso.md`, `packages/ee/src/sso/`, `apps/erp/app/routes/x+/settings+/sso.tsx`). Token sibling: API keys (`apiKey.keyHash`).

## Decisions
- Mode switch: fully autonomous. The user waives the per-phase gates, the spec's open-question interview, and the AGENTS.md "Ask First" stops for auth/RBAC. I record each decision here with its rationale. — 2026-10-30
- Spec gate (open questions): resolved Q1–Q9 autonomously from codebase precedent and research consensus. Key calls: Cloud + self-hosted behind a new `SCIM` plan feature; deactivate = existing per-company `deactivateUser` + delete the person's API keys in the company + GoTrue global logout only when no company is left; groups map to employee types by priority; never change the sign-in email; controlled environment refuses SCIM creates. Rationale in the spec's Design Decisions. — 2026-10-30
- Divergence from the brief: the brief named Settings → SSO (`sso.tsx`). That route is action-only; the SSO UI is on Settings → Security. Provisioning goes on Security with its own action-only route `scim.tsx`. — 2026-10-30
- Plan gate: approved autonomously. Every spec acceptance criterion maps to Tasks 3–9; the browser and IdP-sequence checks run in the test phase. — 2026-10-30

## Phase log
- research: done. Artifact `.ai/research/scim-provisioning.md`. 4 subagents (Okta, Entra + Google, SaaS products, Carbon codebase). GoTrue `/logout` behavior checked in the source. STE-80 pass done.
- spec: done. Artifact `.ai/specs/2026-10-30-scim-provisioning.md`. Q1–Q9 resolved autonomously (marked **Autonomous** in the spec). STE-80 pass done.
- plan: done. Artifact `.ai/plans/2026-10-30-scim-provisioning.md` (11 tasks). STE-80 pass done.
- execute: done. 11 tasks, 12 commits on `naveenkash/scim-2.0-provisioning-spec`. Plan deviations are in the plan file. Gates: typecheck on `@carbon/ee`, `@carbon/auth`, `@carbon/database` and `erp` passes. Tests pass in ee (2660), auth (137) and checks (406, including the conformance scan). Docs typecheck passes. STE-80 pass done on the spec and plan edits.
- test: done. The test ran against this worktree's own stack (`crbn up`, Enterprise edition). I used a private `agent-browser --session`, because another agent shares the default session.

  | # | Check | Result |
  |---|---|---|
  | 1 | No token / wrong token | 401, SCIM Error body |
  | 2 | Entra test connection (random GUID filter) | 200, `totalResults: 0` |
  | 3 | `ServiceProviderConfig` | 200 |
  | 4 | `userName co "a"` | 400 `invalidFilter` |
  | 5 | Okta POST jane | 201; employee active, Admin type, membership, 68 grants (= the type's) |
  | 6 | Duplicate POST, other letter case | 409 `uniqueness` |
  | 7 | POST for the existing `test@carbon.ms` | 201; same user id and type (adopted) |
  | 8 | Entra PATCH `Replace active "False"` (jane, one company) | membership 0, employee inactive, API key deleted, grants 0, refresh token refused (400) |
  | 9 | Okta AIW PUT `active: false` (bob, two companies) | membership here 0, other company kept, refresh token still works (200) |
  | 10 | GET after deactivate | returns `active: false` |
  | 11 | Okta no-path PATCH `active: true` | membership back, 68 grants |
  | 12 | POST /Groups with an unknown member id | 201; unknown id dropped |
  | 13 | `excludedAttributes=members` | no `members` in the body |
  | 14 | Entra default remove (`value` array) | 204; member removed |
  | 15 | UI: map Buyers → Purchasing, priority 10 | jane gets Purchasing and exactly its 3 grants; others untouched |
  | 16 | Entra flag remove `members[value eq "id"]` | 204; jane back to Admin, 68 grants |
  | 17 | Okta rename (no-path `{ id, displayName }`) | 204; renamed |
  | 18 | Paged GET (`count=2`) | total 3, page 2 |
  | 19 | DELETE jane | 204; then GET 404; `user` row kept |
  | 20 | Audit log on, reactivate + create | entries with actor "SCIM (Okta)" in the table (screenshot `.context/scim-audit-list.png`) |
  | 21 | UI: regenerate token | old token 401, new token 200 |
  | 22 | UI: turn off | connection and SCIM rows gone, 3 memberships kept, token 401 |

  Not run live: the plan `403`, `CONTROLLED_ENVIRONMENT`, the rate limit, hosted Supabase logout, the Okta Spec Test and the Microsoft SCIM Validator (they need a public URL). Found: each SCIM change also gets a "System" audit row from the event-system trigger (recorded in the spec's Known gaps).
- self-review: done. Found and fixed 3 Must-fix items (commit `cfbd371fa2`), each re-tested live:
  1. PostgREST `ilike` read `*` as a wildcard, so a `userName` filter could return the wrong person. Fixed with `lower() = lower()` over Kysely.
  2. Deactivation stored `active: false` before offboarding and answered 200 on failure, so the IdP never retried. Fixed: `active` is stored after success, and a failure answers 500.
  3. In a controlled environment SCIM could add an existing non-member or reactivate a person without the attestation. Fixed: both answer 403.
  Left open: the duplicate "System" audit row per change, a group create that is two transactions, and empty translations for the 12 non-English locales.

## Outcome
- Done on branch `naveenkash/scim-2.0-provisioning-spec`, 13 commits, not pushed, no PR. The spec stays in `.ai/specs/` with status implemented: moving it to `implemented/` waits for the PR review.
