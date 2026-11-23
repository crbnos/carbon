// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it, vi } from "vitest";
import {
  ensureIssueSyncSubscriptions,
  ISSUE_SYNC_TABLES,
  issueSyncSubscriptionName
} from "./subscriptions";

function makeClient(existingRows: Array<{ id: string; table: string }>) {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "create_event_system_subscription") {
      return { data: [{ id: "sub_new" }], error: null };
    }
    return { data: null, error: null };
  });

  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: async () => ({ data: existingRows, error: null })
      })
    })
  }));

  return { rpc, from } as any;
}

describe("ensureIssueSyncSubscriptions", () => {
  it("upserts one ISSUE_SYNC subscription per synced table", async () => {
    const client = makeClient([]);
    const result = await ensureIssueSyncSubscriptions(client, "c1", "linear");

    const creates = client.rpc.mock.calls.filter(
      ([fn]: [string]) => fn === "create_event_system_subscription"
    );
    expect(creates).toHaveLength(ISSUE_SYNC_TABLES.length);
    for (const [, params] of creates) {
      expect(params).toMatchObject({
        p_name: "linear-issue-sync",
        p_company_id: "c1",
        p_handler_type: "ISSUE_SYNC",
        p_operations: ["UPDATE", "DELETE"],
        p_config: { tracker: "linear" }
      });
    }
    expect(result.removed).toEqual([]);
  });

  it("removes a subscription whose table is no longer synced", async () => {
    const client = makeClient([
      { id: "s1", table: "nonConformanceActionTask" },
      { id: "s2", table: "job" }
    ]);
    const result = await ensureIssueSyncSubscriptions(client, "c1", "jira");

    expect(result.removed).toEqual(["job"]);
    expect(client.rpc).toHaveBeenCalledWith(
      "delete_event_system_subscription",
      { p_subscription_id: "s2" }
    );
  });

  it("names the subscription per tracker", () => {
    expect(issueSyncSubscriptionName("jira")).toBe("jira-issue-sync");
  });
});
