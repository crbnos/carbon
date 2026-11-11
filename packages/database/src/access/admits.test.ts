// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type AccessActor, admits } from "./admits";
import type { ExpandedClaims } from "./resolve";

const receiptsEdit: ExpandedClaims = {
  "inventory.receipts": {
    view: ["c1"],
    create: ["c1"],
    update: ["c1"],
    delete: []
  }
};

const employee: AccessActor = {
  type: "user",
  role: "employee",
  permissions: receiptsEdit
};
const user = (role: string | null): AccessActor => ({
  type: "user",
  role,
  permissions: receiptsEdit
});
const key = (permissions: ExpandedClaims): AccessActor => ({
  type: "apiKey",
  permissions
});

describe("admits", () => {
  it("passes the system actor everywhere, and only it on system", () => {
    expect(admits({ type: "system" }, "c1", "system")).toBe(true);
    expect(
      admits({ type: "system" }, "c1", { "inventory.receipts": "Full" })
    ).toBe(true);
    expect(admits(employee, "c1", "system")).toBe(false);
    expect(admits(key(receiptsEdit), "c1", "system")).toBe(false);
  });

  it("reads {} and employee as membership of the company", () => {
    for (const requirement of [{}, "employee"] as const) {
      expect(admits(employee, "c1", requirement)).toBe(true);
      expect(
        admits(
          { type: "user", role: "employee", permissions: {} },
          "c1",
          requirement
        )
      ).toBe(true);
      expect(admits(key(receiptsEdit), "c1", requirement)).toBe(true);
      expect(admits(key(receiptsEdit), "c2", requirement)).toBe(false);
      expect(admits(key({}), "c1", requirement)).toBe(false);
    }
  });

  it("refuses a user with no role, and portal accounts unless allowed", () => {
    for (const role of [null, "customer", "supplier"]) {
      expect(admits(user(role), "c1", {})).toBe(false);
      expect(admits(user(role), "c1", "employee")).toBe(false);
      expect(admits(user(role), "c1", { "inventory.receipts": "View" })).toBe(
        false
      );
      expect(admits(user(role), "c1", {}, { allowPortalAccounts: true })).toBe(
        true
      );
    }
  });

  it("checks a gate with holdsGate", () => {
    expect(admits(employee, "c1", { "inventory.receipts": "Edit" })).toBe(true);
    expect(admits(employee, "c1", { "inventory.receipts": "Full" })).toBe(
      false
    );
    expect(
      admits(employee, "c1", {
        anyOf: [
          { "inventory.receipts": "Full" },
          { "inventory.receipts": "View" }
        ]
      })
    ).toBe(true);
    expect(
      admits(key(receiptsEdit), "c1", { "inventory.receipts": "Edit" })
    ).toBe(true);
  });
});
