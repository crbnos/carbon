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
