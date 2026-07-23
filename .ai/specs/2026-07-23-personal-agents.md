# Personal Agents (Kody Pattern)

> Status: draft — Phase 1 foundation implemented (schema); runtime deferred pending open questions
> Author: carbon-agent
> Issue: #1145
> Date: 2026-07-23
> Related: `.ai/specs/in-app-agent.md` (shared runtime — see §Relationship)

## TLDR

Per-user, user-scoped AI agents inside the ERP: each user owns one or more agents
with their own config and persisted sessions. This spec delivers the **data-model
foundation** (two RLS-isolated tables + a permission module) as a reviewable
migration, and specifies — but does **not** yet build — the agent runtime, because
the runtime executes as a *proxied user* (auth/RBAC/multi-tenancy: Ask-First) and
its core design questions are unresolved and overlap the unbuilt in-app-agent work.

## Relationship to `in-app-agent.md`

The two specs describe **the same runtime from two angles** and must not be built
as duplicate stacks:

- `in-app-agent.md` — a right-side chat panel over the existing MCP tool surface
  (`direct-executor.ts` + `tool-metadata.json`), streaming, persistence. It is
  **unbuilt** and blocked on a HARD STOP of open questions (model choice, feature
  flag, MCP coexistence).
- This spec (#1145) — the **per-user identity + config + memory layer**: who owns
  an agent, what it's allowed to do, and its session/memory persistence.

**Decision:** Personal Agents is the ownership/config/session layer; the in-app
agent is the execution/UI layer. Phase 2 of this feature should build on that
runtime rather than fork a second one. Both should land only after the in-app-agent
open questions are resolved.

## What the issue got wrong vs. Carbon conventions (corrected here)

The issue text proposed `personal_agents(id, user_id, config, ...)` and
`personal_agent_sessions(...)`. Grounded against the codebase, three corrections:

| Issue text | Carbon reality | Correction |
|-----------|----------------|-----------|
| `id, user_id` only, no tenant | **Every** table is multi-tenant: `companyId` + composite PK `("id","companyId")` | Added `companyId` + composite PK + FK to `company` |
| snake_case `personal_agents` | Carbon tables are camelCase singular (`changeOrder`, `personalAgent`) | Renamed `personalAgent` / `personalAgentSession` |
| "RLS so users access only their own" (unspecified) | Default Carbon RLS is *company-role* scoped, not per-user; the sibling spec wrongly used deprecated `has_role()` | Per-user RLS: `"userId" = (SELECT auth.uid())::text` **AND** company-permission check (passkey-credential pattern) |
| implicit `created_at/updated_at` | Mandatory audit quartet `createdBy/createdAt/updatedBy/updatedAt`; any `createdBy` requires nullable `updatedBy` | Added full audit columns + FKs + indexes |

## Provider Reality (important)

- The **only** wired AI provider is **OpenAI**, used exclusively for one-shot
  `generateObject` extraction (CSV mapping, filename parsing, inspection vision).
  There is **no** streaming, **no** multi-turn chat, and **no** persistence today.
- `@ai-sdk/anthropic` is installed but imported nowhere. `packages/utils/src/llm.ts`
  exports `anthropicAgentModel = "claude-3-7-sonnet-20250219"` — **dead code pinning
  a retired model id** (would 404). If Claude is chosen, wire a real client + key
  path and use a current id (e.g. `claude-sonnet-4-6`), not that constant.
- `@ai-sdk/react` + `@ai-sdk-tools/{agents,memory,artifacts,store}` are installed
  but unused — the intended home for a `useChat`/agent-memory runtime.

`personalAgent.modelId` therefore defaults to `'gpt-4o'` (the only thing that works
today). Changing the default to Claude is an explicit Phase-2 decision with an
infra prerequisite.

## Data Model (Phase 1 — implemented)

Migration: `packages/database/supabase/migrations/20260723030442_personal-agents.sql`.
Two new tables, one new permission module. No changes to existing tables.

### `personalAgent`
User-owned agent definition. Columns: `id (id('pa'))`, `companyId`, `userId`,
`name`, `description?`, `modelId` (default `gpt-4o`), `config JSONB` (allowed
actions / context-window prefs / TTL — shape enforced in app layer, not DB),
`active`, audit quartet. Composite PK `("id","companyId")`; FKs to `company`,
`user` (owner + audit). Indexes on `companyId`, `(userId, companyId)`, `createdBy`.

### `personalAgentSession`
One row per session/conversation. Columns: `id (id('pas'))`, `companyId`,
`agentId`, `userId`, `sessionKey`, `context JSONB` (message history / working
memory), `startedAt`, `endedAt?`, `expiresAt?` (TTL), audit quartet. FK to
`personalAgent("id","companyId")` ON DELETE CASCADE. Unique index
`(agentId, sessionKey, companyId)`; indexes on `companyId`, `(agentId,companyId)`,
`(userId,companyId)`, `createdBy`.

### RLS (both tables)
Combined per-user + company scope on all four policies:
```sql
"userId" = (SELECT auth.uid())::text
AND "companyId" = ANY ((SELECT get_companies_with_employee_role())::text[])          -- SELECT
AND "companyId" = ANY ((SELECT get_companies_with_employee_permission('personalagents_<action>'))::text[])  -- I/U/D
```

### Permission module
`ALTER TYPE "module" ADD VALUE 'PersonalAgents'` → recreate `modules` view → seed
`employeeTypePermission` for existing employee types. Permission keys resolve to
`personalagents_{view,create,update,delete}` (the module enum is lowercased with no
separator — `PersonalAgents` → `personalagents`, verified against `update-permissions.ts`,
`seed-company`, and the uppercase-key cleanup in `20250115143927`). The read helper
`get_companies_with_employee_permission` matches keys in `userPermission.permissions`
(not `employeeTypePermission`), so the migration also **inline-materializes**
`personalagents_*` onto existing users' `userPermission` (quality-module precedent) —
without it the grant is half-applied and every write is silently denied until the
`carbon/update-permissions` job runs. New companies inherit via `seed-company`.
**This touches the RBAC system — the PR is the human approval gate.**

## Phase 2 — Runtime (specified, NOT built; needs open questions resolved)

Turnkey once the migration is applied and types regenerated (`pnpm generate:types`):

- **Module** `apps/erp/app/modules/personalAgents/`: `personalAgents.models.ts`
  (zod validators — `personalAgentValidator`, `personalAgentSessionValidator`,
  a zod schema for the `config` JSONB), `personalAgents.service.ts` (CRUD:
  `getPersonalAgents(client, companyId, userId, args)`, `getPersonalAgent`,
  `upsertPersonalAgent`, `deletePersonalAgent`, session equivalents — all
  returning raw `{data,error}`, scoped `.eq("companyId", …).eq("userId", …)`),
  `index.ts` barrel, `AGENTS.md`.
- **Routes**: list page `x+/personal-agents+/personal-agents.tsx`, create/edit
  modal routes (`.new`, `.$id`) using `ValidatedForm`; API endpoints
  `api+/personal-agents.ts` (list) and session routes. Register in
  `useModules.tsx` + a `usePersonalAgentsSubmodules` hook + `_layout.tsx`.
- **Execution** (Ask-First): the LLM loop that runs *as the owning user* over the
  MCP tool surface, streaming via Supabase Realtime, persisting turns into
  `personalAgentSession.context`. Reads: user's tasks, pending approvals, module
  search. Creates: drafts only. Destructive/post actions require explicit approval.
- **Guardrails** (Ask-First): action-approval workflow, per-agent rate limiting,
  session TTL enforcement (`expiresAt`), audit logging of every agent action.

## Open Questions (HARD STOP before Phase 2 runtime)

1. **Model/provider** — default `gpt-4o` (only wired option) or invest in wiring
   Claude (`@ai-sdk/anthropic` + `ANTHROPIC_API_KEY` + current model id)? Ties to
   the identical in-app-agent question.
2. **One runtime or two** — confirm Personal Agents builds on the in-app-agent
   runtime rather than forking a parallel chat/stream/persist stack.
3. **Proxied-user execution boundary** — exact mechanism by which an agent acts
   with the user's RBAC without privilege escalation, and how "requires user
   approval for destructive ops" is enforced server-side. This is the core
   auth/RBAC design and must be reviewed by a human (Ask-First).
4. **Feature flag / plan tier** — gate behind a flag/tier or ship to all?
5. **Config schema** — concrete shape of `personalAgent.config` (allowed-action
   allowlist format, context-window prefs, TTL) before the zod validator is frozen.

## Acceptance Criteria

Phase 1 (this PR):
- [x] `personalAgent` + `personalAgentSession` tables, Carbon-convention-compliant
- [x] Per-user RLS isolates agents/sessions to their owner within a company
- [x] `PersonalAgents` permission module registered + seeded
- [ ] Migration applied + types regenerated (requires a running DB — CI on merge)

Phase 2 (deferred, per open questions): service layer, API endpoints, list/create
UI, streaming chat, approval workflow, rate limiting, audit, session TTL.

## Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Migration ALTERs `module` enum + seeds permissions (RBAC) | Med | Additive-only, follows quality-module precedent; gated by PR review before merge/apply |
| Building a second runtime duplicating in-app-agent | Med | §Relationship mandates one runtime; Phase 2 blocked on OQ #2 |
| Proxied-user execution → privilege escalation | High | Runtime is Ask-First + OQ #3; not built until human-reviewed |
| Claude assumed but not wired | Low | Default `gpt-4o`; Anthropic flagged as infra prerequisite |

## Changelog

- 2026-07-23: Created. Phase 1 migration (schema + permission module) implemented;
  runtime specified and deferred pending open questions.
- 2026-07-23: Completed the RBAC grant — added inline `userPermission` materialization
  for existing users (was half-applied; only `employeeTypePermission` was seeded).
  Verified `personalagents_*` key derivation against the code. Isolated the foundation
  commit onto clean `main` (branch had carried an unrelated commit).
