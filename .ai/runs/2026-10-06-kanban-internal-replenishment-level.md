# Feature run: Kanban internal replenishment with a replenishment level

- Date: 2026-10-06
- Mode: fully-autonomous (non-interactive session; the ask is research + spec only)
- Request: On a Kanban circuit, it currently creates a PO or Job requirement (when triggered). We need an additional option on a Kanban circuit to request a replenishment from another Storage Unit. The Kanban circuit should have: 'Internal' option, Storage Unit To, Storage Unit From, Quantity to replenish, Replenishment level (see screen shot below for suggested layout + description). When triggered, a Released Stock transfer should be created. The stock transfer should include a note stating 'Kanban replenishment' or similar, to differentiate from a manually created stock transfer. This action should be triggered in the following ways: Scan QR code (or URL depending on the setting) - existing functionality; Quantity in the 'To' storage Location dropping below the 'Replenishment level'. "can u research on this and make a in depth and detailed spec"
- Phase plan: research [run — ERP inventory domain, never invent replenishment logic] · spec [run — data model change + cross-module (inventory, jobs)] · plan [skip — the user asked for research and a spec only] · execute [skip — same] · test [skip — same] · self-review [skip — same]
- Note: the request mentions a screenshot. No image reached this session. The spec records the layout from the text only.

## Decisions
- Spec gate (every Open Question resolved): resolved autonomously, 13 questions, each by codebase precedent, then research, then recommendation. The most consequential: keep the stored enum value `Transfer` instead of renaming it `Internal` (Q1); one transfer of the fixed quantity per signal (Q3); event-driven on `itemLedger` plus an hourly sweep (Q5). The user reviews all 13 before `/plan`. — 2026-10-06
- Autonomy: fully-autonomous — the session is non-interactive and the user cannot answer mid-run. Open questions are resolved by codebase precedent, then research, then recommendation, and listed for the user to overturn. — 2026-10-06
- Scope: stop after the spec. /plan and /execute are deferred to a later run that the user starts. — 2026-10-06

## Phase log
- research: done — `.ai/research/kanban-internal-replenishment-level.md` (SAP, Dynamics 365, Epicor, Odoo, NetSuite WMS, Fishbowl; 6 consensus patterns, 7 questions answered, 8 recommendations). STE-80 pass done.
- spec: done — `.ai/specs/2026-10-06-kanban-internal-replenishment-level.md`, status draft. Open Questions 1–13 resolved autonomously and marked for review. STE-80 pass done.
- plan: done (2026-10-09) — `.ai/plans/2026-10-06-kanban-internal-replenishment-level.md`, 19 tasks. The planning pass found 10 spec facts that the code contradicts; the spec is corrected and its Changelog lists them. The user removed the demo dataset seeding from scope. STE-80 pass done on the plan and the spec.
- execute: Tasks 1–18 done and verified (2026-10-09), not committed. Task 19 gates green: typecheck of 8 packages, Biome on 25 changed files, tests (database 419, server-functions 462 incl. 8 live-database, jobs 933, documents 57, content 17, checks 278, erp 1992), the SQL test script, `db:check:datasets`, `db:check:backups`, docs typecheck, and a rolled-back probe that proves both triggers queue `carbon/kanban.level-check`.
- test / self-review: not run — the browser test waits for the user's approval.

## Outcome
- Implemented, uncommitted. Next step for the user: approve the browser test and say how to commit.
