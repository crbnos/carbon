// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/ee/workflows.server", () => ({
  requireWorkflowsEntitlement: vi.fn(async () => undefined)
}));

const { publishWorkflowVersion, OWNER_ONLY_PUBLISH_MESSAGE } = await import(
  "./workflows.service"
);

/** A client whose `workflow` row has the given owner; records every update. */
function clientWithOwner(ownerId: string) {
  const updates: unknown[] = [];
  const query = (row: unknown) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: row, error: null }),
      update: (values: unknown) => {
        updates.push(values);
        return chain;
      }
    };
    return chain;
  };
  const client = {
    from: (table: string) => {
      if (table === "workflow") return query({ ownerId });
      throw new Error(`Not read here: ${table}`);
    }
  };
  return { client: client as never, updates };
}

describe("publishWorkflowVersion", () => {
  it("refuses anyone but the owner, before it reads the version or writes", async () => {
    const { client, updates } = clientWithOwner("user-owner");

    const result = await publishWorkflowVersion(client, {} as never, {
      workflowId: "wf-1",
      versionId: "wfv-1",
      companyId: "company-1",
      userId: "user-editor"
    });

    expect(result).toEqual({
      ok: false,
      issues: [],
      message: OWNER_ONLY_PUBLISH_MESSAGE
    });
    expect(updates).toEqual([]);
  });

  it("lets the owner through to the version read", async () => {
    const { client } = clientWithOwner("user-owner");

    await expect(
      publishWorkflowVersion(client, {} as never, {
        workflowId: "wf-1",
        versionId: "wfv-1",
        companyId: "company-1",
        userId: "user-owner"
      })
    ).rejects.toThrow("Not read here: workflowVersion");
  });
});
