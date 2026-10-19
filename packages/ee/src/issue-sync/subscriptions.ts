// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Database } from "@carbon/database";
import {
  createEventSystemSubscription,
  deleteEventSystemSubscription
} from "@carbon/database/event";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IssueTracker, SyncedEntityType } from "./types";

/**
 * The tables whose changes the outbound Linear and Jira push listens to.
 * UPDATE pushes the changed fields; DELETE removes the link. INSERT is not
 * subscribed: a new row has no link yet.
 */
export const ISSUE_SYNC_TABLES: SyncedEntityType[] = [
  "nonConformanceActionTask",
  "changeOrderActionTask",
  "projectElement"
];

export function issueSyncSubscriptionName(tracker: IssueTracker): string {
  return `${tracker}-issue-sync`;
}

/**
 * Converge a company's `${tracker}-issue-sync` subscriptions onto
 * ISSUE_SYNC_TABLES, as `ensureProviderSubscriptions` does for accounting.
 * Idempotent: the create RPC upserts on (companyId, name, table), and rows
 * for tables no longer in the list are deleted. The install hook, the
 * settings save, the link routes and the inbound jobs all call it, so an
 * existing install converges without a migration.
 */
export async function ensureIssueSyncSubscriptions(
  client: SupabaseClient<Database>,
  companyId: string,
  tracker: IssueTracker
): Promise<{ ensured: string[]; removed: string[] }> {
  const name = issueSyncSubscriptionName(tracker);

  for (const table of ISSUE_SYNC_TABLES) {
    await createEventSystemSubscription(client, {
      table,
      companyId,
      name,
      operations: ["UPDATE", "DELETE"],
      type: "ISSUE_SYNC",
      config: { tracker },
      active: true
    });
  }

  const existing = await client
    .from("eventSystemSubscription")
    .select("id, table")
    .eq("companyId", companyId)
    .eq("name", name);

  if (existing.error) {
    throw new Error(
      `Failed to list ${name} subscriptions: ${existing.error.message}`
    );
  }

  const required = new Set<string>(ISSUE_SYNC_TABLES);
  const removed: string[] = [];
  for (const row of existing.data ?? []) {
    if (!required.has(row.table)) {
      await deleteEventSystemSubscription(client, row.id);
      removed.push(row.table);
    }
  }

  return { ensured: [...ISSUE_SYNC_TABLES], removed };
}
