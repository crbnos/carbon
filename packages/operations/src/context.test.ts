import { describe, expect, it } from "vitest";
import {
  assertOperationPermissions,
  assertSystemCaller,
  hasPermissions,
  type ModulePermissions,
  type OperationContext
} from "./context";

const none = { view: [], create: [], update: [], delete: [] };
const claims: ModulePermissions = {
  inventory: { ...none, view: ["co1"], update: ["co1"] },
  production: { ...none, view: ["co1", "co2"] }
};

describe("hasPermissions", () => {
  it("grants when every required module_action names the company", () => {
    expect(
      hasPermissions(claims, "co1", { update: "inventory", view: "production" })
    ).toBe(true);
  });

  it("refuses when one module_action is missing", () => {
    expect(
      hasPermissions(claims, "co1", {
        update: ["inventory", "production"]
      })
    ).toBe(false);
  });

  it("refuses a permission held in another company only", () => {
    expect(hasPermissions(claims, "co2", { update: "inventory" })).toBe(false);
  });

  it("with nothing required, still needs membership of the company", () => {
    expect(hasPermissions(claims, "co2", {})).toBe(true);
    expect(hasPermissions(claims, "co3", {})).toBe(false);
  });
});

describe("system callers", () => {
  const ctx = { companyId: "co1", userId: "u1" } as OperationContext;

  it("skip the claims lookup", async () => {
    await expect(
      assertOperationPermissions({ ...ctx, system: true }, { update: "x" })
    ).resolves.toBeUndefined();
  });

  it("are the only ones assertSystemCaller admits", () => {
    expect(() => assertSystemCaller(ctx)).toThrow(/server-side/);
    expect(() => assertSystemCaller({ ...ctx, system: true })).not.toThrow();
  });
});
