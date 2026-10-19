// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import type { LinearIssue } from "../linear/lib/types";
import { carbonValues, linearValues } from "./canonical";
import { changedInbound, changedOutbound, nextSync } from "./diff";
import { syncedEntities } from "./entities";
import type { LinkSync, SnapshotValue, SyncedField } from "./types";

const fields = syncedEntities.nonConformanceActionTask.fields;

const issue = (type: string): LinearIssue => ({
  id: "i1",
  title: "T",
  url: "u",
  identifier: "ENG-1",
  description: null,
  dueDate: null,
  state: {
    name: type,
    color: "#000",
    type: type as LinearIssue["state"]["type"]
  },
  assignee: null
});

const snapshot = (
  sync: LinkSync | null,
  sent: SyncedField[],
  carbon: ReturnType<typeof carbonValues>,
  remote: ReturnType<typeof linearValues>
) => {
  const updates: Partial<Record<SyncedField, SnapshotValue>> = {};
  for (const f of sent) {
    updates[f] = { carbon: carbon[f] ?? null, remote: remote[f] ?? null };
  }
  return nextSync(sync, updates);
};

describe("the echo guard", () => {
  it("never bounces a write back to the side it came from", () => {
    // 1. Carbon pushes a task to a new issue (no snapshot yet).
    let row = {
      id: "t1",
      status: "In Progress",
      assignee: null,
      dueDate: null,
      notes: null
    };
    let sync: LinkSync | null = null;
    const pushed = changedOutbound(
      fields,
      carbonValues("nonConformanceActionTask", row),
      sync
    );
    expect(pushed).toEqual(fields);
    sync = snapshot(
      sync,
      pushed,
      carbonValues("nonConformanceActionTask", row),
      linearValues(issue("started"))
    );

    // 2. Linear's webhook for that same update changes nothing in Carbon.
    expect(
      changedInbound(fields, linearValues(issue("started")), sync)
    ).toEqual([]);

    // 3. A Linear user completes the issue: Carbon applies the status.
    const remote = linearValues(issue("completed"));
    const applied = changedInbound(fields, remote, sync);
    expect(applied).toEqual(["status"]);
    row = { ...row, status: "Completed" };
    sync = snapshot(
      sync,
      applied,
      carbonValues("nonConformanceActionTask", row),
      remote
    );

    // 4. The event Carbon's own write raises pushes nothing back.
    expect(
      changedOutbound(
        fields,
        carbonValues("nonConformanceActionTask", row),
        sync
      )
    ).toEqual([]);

    // 5. A later Carbon edit still pushes.
    row = { ...row, status: "Pending" };
    expect(
      changedOutbound(
        fields,
        carbonValues("nonConformanceActionTask", row),
        sync
      )
    ).toEqual(["status"]);
  });
});
