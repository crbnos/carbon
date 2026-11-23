// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { isSerialEntityIncompleteForOperation } from "./operations.service";

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
