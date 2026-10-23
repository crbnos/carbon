// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { diffRows } from "./diff";

describe("diffRows", () => {
  it("reports a target row whose key is not in the base as added", () => {
    const entries = diffRows(
      [{ id: "a", name: "A" }],
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" }
      ],
      { key: "id" }
    );

    expect(entries).toEqual([
      {
        status: "unchanged",
        before: { id: "a", name: "A" },
        after: { id: "a", name: "A" }
      },
      { status: "added", before: null, after: { id: "b", name: "B" } }
    ]);
  });

  it("reports a base row nothing points at as removed", () => {
    const entries = diffRows(
      [
        { id: "a", name: "A" },
        { id: "b", name: "B" }
      ],
      [{ sourceId: "a", name: "A" }],
      { key: "sourceId", ignoredFields: ["sourceId"] }
    );

    expect(entries.map((e) => e.status)).toEqual(["unchanged", "removed"]);
    expect(entries[1]).toEqual({
      status: "removed",
      before: { id: "b", name: "B" },
      after: null
    });
  });

  it("lists only the changed column on a modified row", () => {
    const entries = diffRows(
      [
        {
          id: "a",
          name: "Bracket",
          quantity: 2,
          updatedAt: "2026-10-01",
          companyId: "c1"
        }
      ],
      [
        {
          id: "a",
          name: "Bracket",
          quantity: 3,
          updatedAt: "2026-10-09",
          companyId: "c1"
        }
      ],
      { key: "id" }
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("modified");
    expect(entries[0].changedFields).toEqual({
      quantity: { before: 2, after: 3 }
    });
  });

  it("treats the numeric string 1.50 as equal to the number 1.5", () => {
    const entries = diffRows(
      [{ id: "a", unitCost: "1.50" }],
      [{ id: "a", unitCost: 1.5 }],
      { key: "id" }
    );

    expect(entries).toEqual([
      {
        status: "unchanged",
        before: { id: "a", unitCost: "1.50" },
        after: { id: "a", unitCost: 1.5 }
      }
    ]);
  });
});
