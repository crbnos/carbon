// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// Realtime runs on private broadcast topics (@carbon/query). The
// `supabase_realtime` publication is empty, so a `postgres_changes`
// subscription is accepted, delivers nothing, and reports no error — the ERP
// job page sat on two such subscriptions and never showed an operation
// finished on the shop floor. A table name that has no broadcast handler does
// not compile (`RealtimeTable` is derived from the attachments manifest), so
// this string is the only way left to write a subscription that stays silent.
const POSTGRES_CHANGES = /["'`]postgres_changes["'`]/g;

export const noPostgresChanges: ConformanceCheck = {
  id: "no-postgres-changes",
  description:
    "Realtime subscriptions use broadcast topics, never postgres_changes",
  provenance: {
    deprecates:
      'channel.on("postgres_changes", …) — nothing is published for it to deliver',
    replacedBy:
      "handle.realtime on the route, or useRealtime / useChangedRows / useTableChanges (@carbon/query)",
    since: "2026-10-05"
  },
  scan(file: string, contents: string): Violation[] {
    const violations: Violation[] = [];
    for (const match of contents.matchAll(POSTGRES_CHANGES)) {
      const line = contents.slice(0, match.index).split("\n").length;
      violations.push({
        file,
        line,
        snippet: contents.split("\n")[line - 1]?.trim() ?? "",
        message:
          "Declare the table in the route's `handle.realtime`, or use `useRealtime` / `useChangedRows` from @carbon/query. A table needs a broadcast handler in packages/database/src/event-system/attachments.ts."
      });
    }
    return violations;
  }
};
