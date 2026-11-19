// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  getNextIncompleteSerialEntity,
  isSerialEntityIncompleteForOperation
} from "./operations.service";

const op = "op_rework";

function unit(
  id: string,
  extra: {
    inOperationScope?: boolean;
    done?: boolean;
    status?: "Available" | "Consumed" | "Scrapped";
  } = {}
) {
  return {
    id,
    status: extra.status ?? "Available",
    attributes: extra.done ? { [`Operation ${op}`]: 0 } : {},
    inOperationScope: extra.inOperationScope
  } as const;
}

describe("isSerialEntityIncompleteForOperation with operation scope", () => {
  it("treats a unit outside the operation's scope as not needing it", () => {
    expect(
      isSerialEntityIncompleteForOperation(
        unit("u1", { inOperationScope: false }),
        op
      )
    ).toBe(false);
  });

  it("still needs a scoped unit that hasn't completed the operation", () => {
    expect(
      isSerialEntityIncompleteForOperation(
        unit("u1", { inOperationScope: true }),
        op
      )
    ).toBe(true);
  });

  it("applies to every unit when the operation has no scope", () => {
    expect(isSerialEntityIncompleteForOperation(unit("u1"), op)).toBe(true);
  });

  it("keeps the completion and terminal-status rules inside the scope", () => {
    expect(
      isSerialEntityIncompleteForOperation(
        unit("u1", { inOperationScope: true, done: true }),
        op
      )
    ).toBe(false);
    expect(
      isSerialEntityIncompleteForOperation(
        unit("u1", { inOperationScope: true, status: "Scrapped" }),
        op
      )
    ).toBe(false);
  });
});

describe("getNextIncompleteSerialEntity with operation scope", () => {
  it("skips units outside the scope to reach the reworked one", () => {
    const units = [
      unit("u1", { inOperationScope: false }),
      unit("u2", { inOperationScope: false }),
      unit("u3", { inOperationScope: true })
    ];
    expect(getNextIncompleteSerialEntity(units, op)?.id).toBe("u3");
  });

  it("falls back to the last scoped unit once every scoped unit is done", () => {
    const units = [
      unit("u1", { inOperationScope: true, done: true }),
      unit("u2", { inOperationScope: true, done: true }),
      unit("u3", { inOperationScope: false })
    ];
    expect(getNextIncompleteSerialEntity(units, op)?.id).toBe("u2");
  });
});
