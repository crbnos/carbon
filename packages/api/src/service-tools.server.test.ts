// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { NotFoundError, ServerFnError } from "./errors";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));

import { CarbonError, createServiceContext } from "./service-fn.server";
import { serviceResult, settle, stamp } from "./service-tools.server";

const ctx = createServiceContext({
  actor: { type: "user", userId: "user-1", permissions: {} },
  company: { id: "company-1", groupId: "group-1" },
  caller: {} as never,
  system: () => ({}) as never,
  pg: () => ({}) as never,
  kv: () => ({}) as never
});

describe("stamp", () => {
  it("stamps both audit fields when the call is neither a create nor an update", () => {
    expect(
      stamp(ctx, { name: "A" }, ["companyId", "createdBy", "updatedBy"])
    ).toEqual({
      name: "A",
      companyId: "company-1",
      createdBy: "user-1",
      updatedBy: "user-1"
    });
  });

  it("gives a create createdBy only, and an update updatedBy only", () => {
    const fields = ["companyId", "createdBy", "updatedBy"] as const;
    expect(stamp(ctx, { updatedBy: "x" }, [...fields], "create")).toEqual({
      companyId: "company-1",
      createdBy: "user-1"
    });
    expect(
      stamp(ctx, { id: "r1", createdBy: "x" }, [...fields], "update")
    ).toEqual({
      id: "r1",
      companyId: "company-1",
      updatedBy: "user-1"
    });
  });

  it("overwrites an identity key a caller put one level down or in a row", () => {
    const value = stamp(
      ctx,
      {
        line: { companyId: "other", qty: 1 },
        rows: [{ companyId: "other", createdBy: "mallory" }]
      },
      ["companyId"]
    );
    expect(value).toEqual({
      companyId: "company-1",
      line: { companyId: "company-1", qty: 1 },
      rows: [{ companyId: "company-1", createdBy: "user-1" }]
    });
  });

  it("adds only createdBy to the rows of a list", () => {
    expect(
      stamp(
        ctx,
        [{ qty: 1 }, { qty: 2, companyId: "other" }],
        ["companyId", "createdBy"]
      )
    ).toEqual([
      { qty: 1, createdBy: "user-1" },
      { qty: 2, companyId: "company-1", createdBy: "user-1" }
    ]);
  });

  it("leaves a scalar alone", () => {
    expect(stamp(ctx, "id-1", ["companyId"])).toBe("id-1");
  });
});

describe("serviceResult", () => {
  const category = (value: unknown) =>
    value instanceof CarbonError ? value.category : "value";

  it("returns the data, and a paged list with its count", () => {
    expect(serviceResult(ctx, { data: [1], error: null }, "envelope")).toEqual([
      1
    ]);
    expect(
      serviceResult(ctx, { data: [1], count: 9, error: null }, "envelope", {
        paginates: true
      })
    ).toEqual({ rows: [1], count: 9 });
  });

  it("reads a database error by its code", () => {
    expect(
      category(serviceResult(ctx, { error: { code: "23505" } }, "envelope"))
    ).toBe("conflict");
    expect(
      category(serviceResult(ctx, { error: { code: "PGRST116" } }, "envelope"))
    ).toBe("notFound");
    expect(
      category(serviceResult(ctx, { error: { code: "XX000" } }, "envelope"))
    ).toBe("internal");
  });

  it("keeps a service's own refusal and its message", () => {
    const refusal = serviceResult(
      ctx,
      { error: { code: "CARBON_RULE", message: "Only a Draft can change" } },
      "envelope"
    );
    expect(refusal).toMatchObject({
      category: "rule",
      message: "Only a Draft can change"
    });
  });

  it("reads a server function's refusal by its status", () => {
    const refusal = serviceResult(
      ctx,
      { data: null, error: new ServerFnError("Not yours", 404) },
      "envelope"
    );
    expect(refusal).toMatchObject({
      category: "notFound",
      message: "Not yours"
    });
  });

  it("fails on one failed write of a list, and on a false flag", () => {
    expect(
      category(
        serviceResult(
          ctx,
          [{ error: null }, { error: { code: "23503" } }],
          "envelopes"
        )
      )
    ).toBe("conflict");
    expect(
      serviceResult(ctx, { success: false, message: "Has jobs" }, "flag")
    ).toMatchObject({ category: "rule", message: "Has jobs" });
  });

  it("passes a value with no envelope through", () => {
    expect(serviceResult(ctx, { error: null }, "plain")).toEqual({
      error: null
    });
    expect(serviceResult(ctx, 3, "plain")).toBe(3);
  });
});

describe("settle", () => {
  const refusal = async (thrown: unknown) => {
    const out = await settle(ctx, "post-thing", async () => {
      throw thrown;
    });
    if (!(out instanceof CarbonError)) throw new Error("expected a refusal");
    return { category: out.category, message: out.message };
  };

  it("returns the body's value", async () => {
    expect(await settle(ctx, "post-thing", async () => ({ id: "x" }))).toEqual({
      id: "x"
    });
  });

  it("refuses with the status's category and the engine's own message", async () => {
    expect(await refusal(new NotFoundError("Shipment not found"))).toEqual({
      category: "notFound",
      message: "Shipment not found"
    });
    expect(await refusal(new Error("The shipment has no lines"))).toEqual({
      category: "validation",
      message: "The shipment has no lines"
    });
  });

  it("withholds a data-layer error's text", async () => {
    const pgError = {
      code: "23505",
      severity: "ERROR",
      message: "duplicate key value"
    };
    expect(await refusal(pgError)).toEqual({
      category: "internal",
      message: "The operation could not be completed."
    });
  });
});
