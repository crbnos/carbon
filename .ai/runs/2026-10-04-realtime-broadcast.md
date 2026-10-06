# Realtime broadcast — run log

**Plan:** .ai/plans/2026-10-04-client-query-cache-and-realtime-broadcast.md
**Stack:** local, Realtime v2.89.0, satellite demo dataset (37 items, 119 job operations)

## 2026-10-05 — spike and database tasks

| Check | Result |
|-------|--------|
| The 2 migrations apply on a new database | Pass. `crbn up` applied all 1,099 migrations. |
| `authz sync` after the migrations | Pass. A second `authz check` reports 0 helpers and 0 tables to change. |
| `realtime.messages` policies | Pass. `company topic` and `user topic`, both `SELECT` for `authenticated`. |
| Triggers | Pass. 261 broadcast triggers: 87 tables, 3 operations each. |
| `supabase_realtime` publication | Pass. It holds 0 tables. |
| `realtime-broadcast.test.sql` | Pass. |
| A client joins its own company topic on a private channel | Pass. Status `SUBSCRIBED`. |
| A client joins the topic of another company | Pass. Realtime answers `Unauthorized`. |
| A client joins the notification topic of another user | Pass. Realtime answers `Unauthorized`. |
| A client receives the message for an `UPDATE` of `customer` | Pass on the second run. See the note below. |

## Measurements

| Statement | Broadcast trigger time | Whole statement |
|-----------|------------------------|-----------------|
| `UPDATE` of 1 `jobOperation` row | 1.3 ms | 3.5 ms |
| `UPDATE` of 37 `item` rows | 1.1 ms | 13.3 ms |
| `list_checksums` for the demo company | not applicable | 4.8 ms |

The demo company is small. These numbers do not show the cost on a large company.

## Note: the first message after the first private join

Realtime creates its replication slot for `realtime.messages` when the first
private channel joins. In the first spike run, the client did not receive a
message that Postgres sent 6 seconds after that first join. In the second run,
the slot existed and the client received the message. The catch-up on
`onSubscribed` does not cover this case, because the join itself succeeds.
The cause is not confirmed. Test it again in Task 21.

## 2026-10-05 — change log replaces the checksum

| Check | Result |
|-------|--------|
| `realtime-broadcast.test.sql` with the change-log assertions | Pass. |
| `authz check` after the sync | Pass. 0 helpers, 0 tables, 0 event triggers. |
| Reload with no change | Pass. 1 `table_changes_since` request, 0 table requests. |
| Rename 1 customer while the tab is closed, then open the app | Pass. 1 `table_changes_since` request and 1 `customer` request with `id=in.(<that id>)`. |
| Rename 1 customer while the tab is open | Pass. The cached list shows the new name within 3 seconds. |

Not measured: the cost of the log insert on a write, and the reader on a large company.

## 2026-10-05 — final verification

Automated gates:

| Gate | Result |
|------|--------|
| `pnpm run lint` | Pass. 35 tasks. |
| `pnpm run test` with the local database | Pass. 33 tasks. |
| Typecheck: `erp`, `mes`, `@carbon/query`, `@carbon/react`, `@carbon/auth`, `@carbon/database`, `@carbon/checks`, `@carbon/jobs`, `@carbon/viewer` | Pass. Each one ran alone. |
| `realtime-broadcast.test.sql` | Pass. |
| `authz check` | Pass. 0 helpers, 0 tables, 0 event triggers. |

Browser checks on the local stack (ERP and MES dev servers, satellite demo company):

| Check | Result |
|-------|--------|
| An operator finishes an operation in the MES. The ERP job page in a second tab shows status `Done` with no reload. | Pass. The ERP tab revalidated 1 time. The MES redirected to the operations list. |
| A change to a job operation shows on the ERP bill of process within 3 seconds. | Pass. |
| The ERP sales orders list and the MES operations page revalidate 1 time for 1 change. | Pass. |
| Reload with no change: 1 `table_changes_since` request, 0 table requests. | Pass. |
| Rename 1 customer while the tab is closed: 1 read of that row only. | Pass. |
| A new notification shows in the bell with no reload. | Pass. The count went to 1 and the inbox showed the row. |
| Another writer adds a customer type while a form is open. The picker list updates. | Pass. 4 rows became 5 with 1 refetch. |
| Save a storage unit. The cached storage-unit list refetches with the new name. | Pass. The route has no `clientAction`. |
| A setting saved through `useAction` shows its toast 1 time. | Pass. |
| The 5 module dashboards load their KPI queries. | Pass. |

Not checked:

- Company switch. The local stack has 1 company.
- The MES "Complete Batch" flow. The demo data has no active batch.
- Two signed-in users at the same time. The second writer was a SQL statement.
- `/self-review` has not run on the branch.
- The first message after the first private join on a new Realtime server. It failed 1 time and was not reproduced.
