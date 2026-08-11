# Workflows phase 4 — manual end-to-end check

**Status: pending you.** Everything in the plan's automated verification passed
(see the bottom of this file). This last check needs a running stack and a
seeded database, so it was not run. **Do not rebuild or reset the database.**

## What you need up

```bash
pnpm dev          # or `crbn up` — Supabase, Redis, edge runtime
pnpm --filter @carbon/jobs dev:jobs   # the Inngest dev server, UI at :8288
```

## The workflow to activate

There is no builder UI yet (phase 8), so the version is inserted directly.
Replace `<companyId>` and `<ownerId>` with a real pair, and `<workflowId>` /
`<versionId>` with ids you pick.

```sql
INSERT INTO "workflow" ("id", "companyId", "name", "ownerId", "active", "createdBy")
VALUES ('<workflowId>', '<companyId>', 'PO over 10k', '<ownerId>', TRUE, '<ownerId>');

INSERT INTO "workflowVersion" ("id", "companyId", "workflowId", "formatVersion", "nodes", "edges", "createdBy")
VALUES ('<versionId>', '<companyId>', '<workflowId>', 1,
'[
  {"id":"trigger","type":"trigger","position":{"x":0,"y":0},
   "data":{"events":["purchaseOrder.orderTotal.changed"],"origin":"Both"}},
  {"id":"check","type":"condition","position":{"x":0,"y":200},
   "data":{"paths":[{"id":"over","kind":"if","combinator":"and","clauses":[
     {"left":{"kind":"ref","nodeId":"trigger","output":"record","path":["orderTotal"]},
      "operator":"gt",
      "right":{"kind":"literal","type":{"kind":"primitive","of":"number"},"value":10000}}
   ]}]}}
]'::jsonb,
'[{"id":"e1","source":"trigger","sourceHandle":"out","target":"check","targetHandle":"in"}]'::jsonb);

UPDATE "workflow" SET "activeVersionId" = '<versionId>' WHERE "id" = '<workflowId>';
```

Then derive the trigger subscription (the matcher reads these, not the version):

```sql
INSERT INTO "workflowTriggerEvent" ("companyId", "workflowId", "eventId", "origin")
VALUES ('<companyId>', '<workflowId>', 'purchaseOrder.orderTotal.changed', 'Both');

INSERT INTO "eventSystemSubscription"
  ("name", "table", "companyId", "operations", "handlerType", "config", "filter", "active")
VALUES ('workflow-purchaseOrder', 'purchaseOrder', '<companyId>',
        ARRAY['UPDATE'], 'WORKFLOW', '{}'::jsonb, '{}'::jsonb, TRUE)
ON CONFLICT ON CONSTRAINT "unique_subscription_name_per_company" DO NOTHING;
```

## Fire it

In the ERP, edit a purchase order's total to something above 10,000 (or
`UPDATE "purchaseOrder" SET "orderTotal" = 15000 WHERE id = '<poId>'`).

## Read the result back

```sql
SELECT "id", "status", "statusReason", "error", "durationMs"
FROM "workflowRun"
WHERE "companyId" = '<companyId>' AND "workflowId" = '<workflowId>'
ORDER BY "createdAt" DESC LIMIT 5;

SELECT "sequence", "nodeId", "nodeType", "status", "branchTaken", "statusReason", "error"
FROM "workflowStepRun"
WHERE "runId" = '<runId>'
ORDER BY "sequence";
```

## What passing looks like

- One `workflowRun` row, `status = 'Succeeded'`, `error` null, `durationMs` set.
- One `workflowStepRun` row for `check`, `nodeType = 'condition'`,
  `status = 'Succeeded'`, `branchTaken = 'over'`.
- Editing the same PO to a total **below** 10,000 gives a second run that also
  reaches `Succeeded`, with `branchTaken = 'none'` — no branch matched, which is
  a clean stop, not a failure.
- Re-delivering the same Inngest event produces no second run
  (`workflowRun_dedupe_key`) and no second step row
  (`workflowStepRun_idempotency_key`).

## Also worth trying

- `UPDATE "workflow" SET "active" = FALSE` between the queue and the run: the run
  settles `Skipped` with
  `"This workflow was switched off before the run started."`
- Strip the owner's `purchasing` view permission: the run settles `Failed` with
  `"The owner of this workflow no longer has access to Purchasing."`

## Automated verification already run (2026-07-30)

| Command | Result |
|---|---|
| `pnpm --filter @carbon/workflows test` | 12 files, 180 tests passed |
| `pnpm --filter @carbon/jobs test` | 8 files, 91 tests passed |
| `pnpm --filter @carbon/workflows exec tsgo --noEmit` | no output |
| `pnpm --filter @carbon/jobs exec tsc --noEmit` | no output |
| `pnpm exec turbo run typecheck --filter=erp` | 1 successful |
| `pnpm exec biome check packages/jobs packages/workflows` | 0 errors, 47 pre-existing warnings (same as baseline) |
| `pnpm run check:workflow-catalog` | ok — 106 events, 9 moments raised, 15 entities |
