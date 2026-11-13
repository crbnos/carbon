// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { expandClaims, type Grant, holdsGate } from "@carbon/database/access";
import { describe, expect, it } from "vitest";

import { CONSOLE_OPERATOR_GRANTS, consoleOperatorWork } from "./console-grants";

const COMPANY = "co_1";

function roleClaims() {
  const grants: Grant[] = CONSOLE_OPERATOR_GRANTS.map((g) => ({
    subject: "role",
    module: g.module,
    page: g.page,
    level: g.level!
  }));
  return expandClaims(
    { role: "employee", admin: false, grants, portal: {} },
    COMPANY
  );
}

describe("Console Operator defaults", () => {
  it("pass the gates the MES routes ask for", () => {
    const claims = roleClaims();
    for (const gate of [
      { "production.jobs": "Edit" },
      { "production.batches": "Edit" },
      { "quality.inspections": "Edit" },
      { "quality.issues": "Create" }
    ] as const) {
      expect(holdsGate(claims, gate, COMPANY)).toBe(true);
    }
  });

  it("grant no delete and no administration", () => {
    const claims = roleClaims();
    expect(holdsGate(claims, { "production.jobs": "Full" }, COMPANY)).toBe(
      false
    );
    expect(holdsGate(claims, { "users.accounts": "Edit" }, COMPANY)).toBe(
      false
    );
    expect(holdsGate(claims, { "settings.people": "Edit" }, COMPANY)).toBe(
      false
    );
  });
});

describe("consoleOperatorWork", () => {
  it("creates the type when the company has none", () => {
    expect(consoleOperatorWork(undefined)).toBe("create");
  });

  it("grants a type that was left with no grants", () => {
    expect(consoleOperatorWork({ id: "et_1", grantCount: 0 })).toBe("grant");
  });

  it("leaves a type that holds grants as it is", () => {
    expect(consoleOperatorWork({ id: "et_1", grantCount: 2 })).toBeNull();
  });
});
