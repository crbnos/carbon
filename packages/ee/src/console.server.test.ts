// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { expandClaims, type Grant, holdsGate } from "@carbon/database/access";
import { describe, expect, it, vi } from "vitest";

const replaceGrants = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./entitlements.server", () => ({
  requireEntitlement: vi.fn(async () => undefined)
}));
vi.mock("./plan.server", () => ({ companyHasFeature: vi.fn() }));
vi.mock("@carbon/database/access-write", () => ({ replaceGrants }));

import {
  CONSOLE_OPERATOR_GRANTS,
  updateConsoleSetting
} from "./console.server";

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

describe("updateConsoleSetting", () => {
  function fakeDb(existing: { id: string } | undefined) {
    const inserted: unknown[] = [];
    const where = (filters: unknown[]) => ({
      where: (...f: unknown[]) => where([...filters, f]),
      executeTakeFirst: async () => existing
    });
    const db = {
      updateTable: () => ({
        set: () => ({ where: () => ({ execute: async () => [] }) })
      }),
      selectFrom: () => ({ select: () => where([]) }),
      insertInto: () => ({
        values: (values: unknown) => {
          inserted.push(values);
          return {
            returning: () => ({
              executeTakeFirst: async () => ({ id: "et_console" })
            })
          };
        }
      })
    };
    return { db, inserted };
  }
  // The caller's client is used only for the entitlement check (mocked).
  const client = {};

  it("creates the type as the system and writes its defaults as grants", async () => {
    replaceGrants.mockClear();
    const { db, inserted } = fakeDb(undefined);

    const result = await updateConsoleSetting(
      client as never,
      db as never,
      COMPANY,
      true
    );

    expect(result.error).toBeNull();
    expect(inserted).toEqual([
      {
        name: "Console Operator",
        companyId: COMPANY,
        protected: true,
        systemType: "Console Operator"
      }
    ]);
    expect(replaceGrants).toHaveBeenCalledWith(db, {
      companyId: COMPANY,
      subject: { employeeTypeId: "et_console" },
      grants: CONSOLE_OPERATOR_GRANTS,
      userId: "system"
    });
  });

  it("leaves an existing type and its grants alone", async () => {
    replaceGrants.mockClear();
    const { db, inserted } = fakeDb({ id: "et_existing" });

    const result = await updateConsoleSetting(
      client as never,
      db as never,
      COMPANY,
      true
    );

    expect(result.error).toBeNull();
    expect(inserted).toEqual([]);
    expect(replaceGrants).not.toHaveBeenCalled();
  });
});
