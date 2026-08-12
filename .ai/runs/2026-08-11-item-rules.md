# Feature run: Item Rules (Phases 1–2)

- Date: 2026-08-11
- Mode: fully-autonomous
- Request: "implement this fully" — the Item Rules feature (Phases 1–2) from the finalized PRD at ~/Downloads/carbon_item_rules_prd.html
- Phase plan: research [skip — completed in-session via two Explore agents (storage-rules architecture map + customer/sales-flow map); findings baked into the PRD] · spec [run — convert finalized PRD to canonical .ai/specs artifact; zero open questions remain] · plan [run] · execute [run — commits DEFERRED per standing user instruction (never commit without explicit ask); verified changes left in working tree] · test [skip — standing user instruction: no browser unless asked; verify via typecheck + unit tests] · self-review [run]

## Decisions
- Autonomy mode: fully-autonomous — "implement this fully" + session operating autonomously. (2026-08-11)
- Spec gate (🛑 open questions): auto-passed — PRD explicitly resolved all seven design questions (§3.6 decided conventions + §3.7); nothing open. (2026-08-11)
- Branch: build on current branch `cambridge-bom-feature-gap-audit` (Conductor workspace; renaming/creating refs without asking is disallowed; no commits will be made anyway). (2026-08-11)
- Commits: deferred entirely — user memory requires explicit "commit" green light; /execute verification gates still run per task. (2026-08-11)
- Pre-existing working-tree modifications to generated DB type files (packages/database/src/types.ts, swagger-docs-schema.ts, functions/lib/types.ts) noted at run start — investigate before applying migration; never hand-edit. (2026-08-11)

## Follow-on refactor: "Option A" rules code unification (2026-08-11)
- Decision: keep storageRule/itemRule tables separate (RLS simplicity, self-hosted unattended migrations, schema-divergence pressure); unify the CODE layer under `rules` naming. Table merge (Option B/B′) deliberately deferred until a real cross-family requirement appears — analysis recorded in conversation + spec unaffected.
- Scope: packages/utils storage-rules.ts → rules.ts (symbols unchanged); packages/ee/src/{storage-rules,item-rules} → src/rules/{storage,item} with shared modal+hook at rules/ root; exports ./rules + ./rules.server replace ./storage-rules(.server) + ./item-rules(.server), no aliases; StorageRuleViolationModal→RuleViolationModal, useStorageRuleViolations→useRuleViolations; full import sweep (ERP+MES+packages); AGENTS.md sync. Tables/RLS/plan keys/admin modules untouched.
- COMPLETE + verified: 31 import sites swept (ERP 27, MES 4); zero residual old-path/name greps; typechecks green (utils, ee, erp, mes); tests 76+40 pass; lint clean; renames via git mv. Collision (isBlocked/dedupeViolations dual re-export) resolved with explicit named re-exports in rules/server.ts. Docs synced (utils/ee/item-rules AGENTS.md + 2 .claude/rules files). Spec updated to new paths, pushed to PR #1368 as b1c750457.

## Phase log
- research: skipped (see Phase plan) — evidence lives in the PRD (storage-rules engine map, customer/location model, line-add flows)
- spec: .ai/specs/2026-08-11-item-rules.md (converted from PRD)

## Outcome
- All 16 plan tasks complete. Verification sweep green: typecheck 6/6 packages (@carbon/utils, @carbon/ee, @carbon/database, erp, @carbon/jobs, @carbon/notifications), @carbon/utils 76 tests, @carbon/ee 40 tests, lint clean (32 tasks, only pre-existing warnings).
- Implementation left UNCOMMITTED in the working tree per standing instruction; user reviews and green-lights the commit.
- Two migrations created + applied locally: 20260810214426_item-rules-sales.sql (planned) and 20260810221652_item-rule-notification-group.sql (Task 13 deviation — companySettings.itemRuleNotificationGroup was missing from the plan; additive, flagged).
- Notable deviations (all recorded in agent reports + plan notes): RuleSurface union widening in the engine; ITEM_RULE_FIELD_REGISTRY kept separate from FIELD_REGISTRY; ItemRuleAssignmentsList forked (storage component too coupled); quote transaction quantity = 1 (quantity-break arrays); compound notify documentId ("<type>:<id>:<outcome>") because the notify payload's documentType is a narrower enum; modal-mode onClose moved to onSuccess in both line forms (hook contract).
- Docs PR: https://github.com/crbnos/carbon/pull/1368 (research + spec, updated with data model / API / UI change summary + SQL snippets).
- CodeRabbit review (13 findings) triaged and resolved: 8 spec fixes (canonical evaluator name/signature, existing ITEM_RULES key, blocked-outcome prose, item-only guard, selection contract, assignment tenancy note, customer-context completeness), 2 documented design decisions (evidence atomicity best-effort; per-outcome notification scope, dedup key as follow-up), 2 pre-addressed (surface separation, name uniqueness), 1 implementation improvement: acknowledged-path evidence in the two create actions now inserts AFTER the line write with documentLineId = created line id (blocked path unchanged, null). Validated: erp typecheck exit 0, biome clean. Spec fixes pushed as 9de8a652e.
- Follow-ups recorded: item-rules card on tool/material/consumable inventory routes (part+ only in v1); SurfaceChips not parameterized (plain badges for item surfaces); no item-rule condition-value label resolver wired into evaluateItemRuleLines' message interpolation (labels resolve in builder + storage loaders, raw values in violation messages).
