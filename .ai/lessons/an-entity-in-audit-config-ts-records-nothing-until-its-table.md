---
paths: ["packages/database/src/audit.config.ts", "packages/database/src/event-system/attachments.ts"]
triggers: ["auditConfig", "syncAuditSubscriptions"]
promoted: null
---
# An entity in `audit.config.ts` records nothing until its tables have `events: true`

**Context:** Change notice history (the `changeOrder` audit entity) was empty in the History drawer even with audit logging on (2026-10-08).

**Problem:** `auditConfig.entities.changeOrder` listed its 4 tables, and `syncAuditSubscriptions` created AUDIT subscriptions for them. But `packages/database/src/event-system/attachments.ts` gave `changeOrder` only a statement broadcast and the 3 child tables no entry at all, so no async event trigger existed and nothing reached the event queue. Every check looked green: subscriptions present, sweeper succeeding, queue empty.

**Rule:** When you add an entity to `audit.config.ts`, give each of its tables `events: true` in `attachments.ts` and ship it with `pnpm --filter @carbon/database authz migration <name>`. To debug an empty audit log, first check `pg_trigger` for `trg_event_async_*` on the table.

**Applies to:** `packages/database/src/audit.config.ts`, `packages/database/src/event-system/attachments.ts`.
