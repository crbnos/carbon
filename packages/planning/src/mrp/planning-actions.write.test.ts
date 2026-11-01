// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { groupPatchUpdates } from "./planning-actions";

describe("groupPatchUpdates", () => {
  // One UPDATE per row was thousands of round trips on the weekly roll.
  it("puts rows that change the same columns in one group, whatever the key order", () => {
    expect(
      groupPatchUpdates([
        { id: "a1", patch: { periodId: "p2" } },
        { id: "a2", patch: { suggestedQuantity: 12, status: "Open" } },
        { id: "a3", patch: { periodId: "p3" } },
        { id: "a4", patch: { status: "Dismissed", suggestedQuantity: 4 } }
      ])
    ).toEqual([
      {
        columns: ["periodId"],
        rows: [
          ["a1", "p2"],
          ["a3", "p3"]
        ]
      },
      {
        columns: ["status", "suggestedQuantity"],
        rows: [
          ["a2", "Open", 12],
          ["a4", "Dismissed", 4]
        ]
      }
    ]);
  });

  it("writes trigger values as JSON and a cleared value as null", () => {
    expect(
      groupPatchUpdates([
        {
          id: "a1",
          patch: { triggerValues: { reorderPoint: 5 }, reason: null }
        },
        {
          id: "a2",
          patch: { triggerValues: null, reason: "Below reorder point" }
        }
      ])
    ).toEqual([
      {
        columns: ["reason", "triggerValues"],
        rows: [
          ["a1", null, '{"reorderPoint":5}'],
          ["a2", "Below reorder point", null]
        ]
      }
    ]);
  });

  it("refuses a patch column it has no type for", () => {
    expect(() =>
      groupPatchUpdates([
        { id: "a1", patch: { periodId: "p2" } },
        { id: "a2", patch: { bogus: 1 } }
      ])
    ).toThrow(/bogus/);
  });
});
