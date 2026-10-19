// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { changedInbound, changedOutbound, nextSync } from "./diff";
import type { LinkSync, SyncedField } from "./types";

const fields: SyncedField[] = ["status", "assignee", "dueDate", "description"];

const sync: LinkSync = {
  values: {
    status: { carbon: "In Progress", remote: "started" },
    assignee: { carbon: "u1", remote: "a@x.com" },
    dueDate: { carbon: null, remote: null },
    description: { carbon: "h1", remote: "m1" }
  },
  refused: null
};

describe("changedOutbound", () => {
  it("treats every field as changed when there is no snapshot", () => {
    expect(changedOutbound(fields, {}, null)).toEqual(fields);
  });

  it("returns only the field whose Carbon value moved", () => {
    expect(
      changedOutbound(
        fields,
        {
          status: "Completed",
          assignee: "u1",
          dueDate: null,
          description: "h1"
        },
        sync
      )
    ).toEqual(["status"]);
  });

  it("treats undefined and null as equal", () => {
    expect(
      changedOutbound(
        fields,
        { status: "In Progress", assignee: "u1", description: "h1" },
        sync
      )
    ).toEqual([]);
  });
});

describe("changedInbound", () => {
  it("compares the issue's values with the snapshot's remote values", () => {
    expect(
      changedInbound(
        fields,
        {
          status: "started",
          assignee: "b@x.com",
          dueDate: null,
          description: "m1"
        },
        sync
      )
    ).toEqual(["assignee"]);
  });
});

describe("nextSync", () => {
  it("keeps the fields it does not update", () => {
    const next = nextSync(sync, {
      status: { carbon: "Completed", remote: "completed" }
    });
    expect(next.values.status).toEqual({
      carbon: "Completed",
      remote: "completed"
    });
    expect(next.values.assignee).toEqual(sync.values.assignee);
  });

  it("keeps the refusal unless one is given, and null clears it", () => {
    const refused = { at: "t", fields: ["status"], reason: "locked" };
    const withRefusal = nextSync(sync, {}, refused);
    expect(withRefusal.refused).toEqual(refused);
    expect(nextSync(withRefusal, {}).refused).toEqual(refused);
    expect(nextSync(withRefusal, {}, null).refused).toBeNull();
  });
});
