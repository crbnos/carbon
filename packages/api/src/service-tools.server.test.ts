// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { NotFoundError, ServerFnError } from "./errors";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));

import { CarbonError, createServiceContext } from "./service-fn.server";
import { paged, payload, run, unwrap } from "./service-tools.server";

const ctx = createServiceContext({
  actor: { type: "user", userId: "user-1", permissions: {} },
  company: { id: "company-1", groupId: "group-1" },
  caller: {} as never,
  system: () => ({}) as never,
  pg: () => ({}) as never,
  kv: () => ({}) as never
});

describe("payload", () => {
  it("gives an upsert both audit fields", () => {
    expect(payload(ctx, { name: "A" }).forUpsert()).toEqual({
      name: "A",
      companyId: "company-1",
      createdBy: "user-1",
      updatedBy: "user-1"
    });
  });

  it("gives a create createdBy only, and an update updatedBy only", () => {
    expect(payload(ctx, { updatedBy: "x" }).forCreate()).toEqual({
      companyId: "company-1",
      createdBy: "user-1"
    });
    expect(payload(ctx, { id: "r1", createdBy: "x" }).forUpdate()).toEqual({
      id: "r1",
      companyId: "company-1",
      updatedBy: "user-1"
    });
  });

  it("overwrites every identity key a caller put at the top level, listed or not", () => {
    expect(
      payload(ctx, {
        companyId: "other",
        companyGroupId: "other-group",
        createdBy: "mallory",
        updatedBy: "mallory",
        userId: "target-user"
      }).build()
    ).toEqual({
      companyId: "company-1",
      companyGroupId: "group-1",
      createdBy: "user-1",
      updatedBy: "user-1",
      userId: "target-user"
    });
    expect(payload(ctx, { createdBy: "mallory" }).forUpdate()).toEqual({
      companyId: "company-1",
      updatedBy: "user-1"
    });
  });

  it("sets userId and companyGroupId only when asked, and leaves out companyId", () => {
    expect(payload(ctx, { userId: "target" }).build()).toEqual({
      userId: "target",
      companyId: "company-1"
    });
    expect(payload(ctx, {}).withUser().withGroup().build()).toEqual({
      userId: "user-1",
      companyId: "company-1",
      companyGroupId: "group-1"
    });
    expect(payload(ctx, { name: "A" }).withoutCompany().forCreate()).toEqual({
      name: "A",
      createdBy: "user-1"
    });
    expect(payload(ctx, { createdBy: "x" }).for("update")).toEqual({
      companyId: "company-1",
      updatedBy: "user-1"
    });
  });

  it("overwrites an identity key a caller put one level down or in a row", () => {
    const value = payload(ctx, {
      line: { companyId: "other", qty: 1 },
      rows: [{ companyId: "other", createdBy: "mallory" }]
    }).build();
    expect(value).toEqual({
      companyId: "company-1",
      line: { companyId: "company-1", qty: 1 },
      rows: [{ companyId: "company-1", createdBy: "user-1" }]
    });
  });

  it("adds only createdBy to the rows of a list", () => {
    expect(
      payload(ctx, [{ qty: 1 }, { qty: 2, companyId: "other" }]).forCreate()
    ).toEqual([
      { qty: 1, createdBy: "user-1" },
      { qty: 2, companyId: "company-1", createdBy: "user-1" }
    ]);
  });

  it("leaves a scalar alone", () => {
    expect(payload(ctx, "id-1").build()).toBe("id-1");
  });
});

describe("unwrap and paged", () => {
  const category = (value: unknown) =>
    value instanceof CarbonError ? value.category : "value";

  it("returns the data, and a paged list with its count", () => {
    expect(unwrap(ctx, { data: [1], error: null })).toEqual([1]);
    expect(paged(ctx, { data: [1], count: 9, error: null })).toEqual({
      rows: [1],
      count: 9
    });
  });

  it("reads a database error by its code", () => {
    expect(category(unwrap(ctx, { error: { code: "23505" } }))).toBe(
      "conflict"
    );
    expect(category(unwrap(ctx, { error: { code: "PGRST116" } }))).toBe(
      "notFound"
    );
    expect(category(unwrap(ctx, { error: { code: "XX000" } }))).toBe(
      "internal"
    );
  });

  it("keeps a service's own refusal and its message", () => {
    const refusal = unwrap(ctx, {
      error: { code: "CARBON_RULE", message: "Only a Draft can change" }
    });
    expect(refusal).toMatchObject({
      category: "rule",
      message: "Only a Draft can change"
    });
  });

  it("passes a message our own SQL raised through as a rule refusal", () => {
    const raised = unwrap(ctx, {
      data: null,
      error: {
        code: "P0001",
        details: null,
        hint: null,
        message: "Only open periods can be locked"
      }
    });
    expect(raised).toMatchObject({
      category: "rule",
      message: "Only open periods can be locked"
    });
    expect(category(unwrap(ctx, { error: { code: "P0001" } }))).toBe(
      "internal"
    );
  });

  it("reads a server function's refusal by its status", () => {
    const refusal = unwrap(ctx, {
      data: null,
      error: new ServerFnError("Not yours", 404)
    });
    expect(refusal).toMatchObject({
      category: "notFound",
      message: "Not yours"
    });
  });

  it("gives several results' data, or the first refusal", () => {
    expect(
      unwrap(ctx, { data: 1, error: null }, { data: "b", error: null })
    ).toEqual([1, "b"]);
    expect(
      category(
        unwrap(ctx, { data: 1, error: null }, { error: { code: "23503" } })
      )
    ).toBe("conflict");
  });

  it("passes a value with no envelope through", () => {
    expect(unwrap(ctx, { error: null })).toEqual({ error: null });
  });
});

describe("run", () => {
  const refusal = async (thrown: unknown) => {
    const out = await run(ctx, "post-thing", async () => {
      throw thrown;
    });
    if (!(out instanceof CarbonError)) throw new Error("expected a refusal");
    return { category: out.category, message: out.message };
  };

  it("returns the body's value", async () => {
    expect(await run(ctx, "post-thing", async () => ({ id: "x" }))).toEqual({
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

  it("keeps a programming error or a thrown 5xx internal, its text withheld", async () => {
    const internal = {
      category: "internal",
      message: "The operation could not be completed."
    };
    expect(
      await refusal(new TypeError("Cannot read properties of undefined"))
    ).toEqual(internal);
    expect(
      await refusal(new ServerFnError("Journal out of balance", 500))
    ).toEqual(internal);
  });

  it("withholds a database or network failure's text", async () => {
    expect(
      await refusal(
        Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
          code: "ECONNREFUSED",
          syscall: "connect"
        })
      )
    ).toEqual({
      category: "internal",
      message: "The operation could not be completed."
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
