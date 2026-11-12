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

  it("holds for an element, whose status is its state group", () => {
    const elementFields = syncedEntities.projectElement.fields;
    const ctx = {
      stateGroupById: new Map([
        ["doing", "Started" as const],
        ["review", "Started" as const],
        ["done", "Completed" as const]
      ])
    };
    let row: Record<string, unknown> & { id: string } = {
      id: "e1",
      name: "Bracket",
      stateId: "doing",
      ownerId: null,
      priority: "High",
      targetDate: null,
      description: null
    };
    const remote = (type: string) => ({
      ...linearValues(issue(type)),
      title: "Bracket",
      priority: "2"
    });

    // Push, then the echo of that push.
    let sync = snapshot(
      null,
      elementFields,
      carbonValues("projectElement", row, ctx),
      remote("started")
    );
    expect(changedInbound(elementFields, remote("started"), sync)).toEqual([]);

    // Moving to another Started state changes nothing the tracker sees.
    row = { ...row, stateId: "review" };
    expect(
      changedOutbound(
        elementFields,
        carbonValues("projectElement", row, ctx),
        sync
      )
    ).toEqual([]);

    // Completing it in Linear applies once, and the write does not bounce.
    const applied = changedInbound(elementFields, remote("completed"), sync);
    expect(applied).toEqual(["status"]);
    row = { ...row, stateId: "done" };
    sync = snapshot(
      sync,
      applied,
      carbonValues("projectElement", row, ctx),
      remote("completed")
    );
    expect(
      changedOutbound(
        elementFields,
        carbonValues("projectElement", row, ctx),
        sync
      )
    ).toEqual([]);
  });
});
