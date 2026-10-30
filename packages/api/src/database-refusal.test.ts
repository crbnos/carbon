// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));

import { databaseRefusal } from "./database-refusal";
import { createServiceContext, defineServiceFn } from "./service-fn.server";

// Shapes copied from what PostgREST and node-postgres return.
const duplicateId = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "jobOperation_pkey"',
  details: 'Key (id, "companyId")=(abc, c1) already exists.'
};
const missingProcedure = {
  code: "23503",
  message:
    'insert or update on table "jobOperation" violates foreign key constraint "jobOperation_procedureId_fkey"',
  details: 'Key ("procedureId")=(p1) is not present in table "procedure".'
};

describe("databaseRefusal", () => {
  it("names the duplicate key, without the company or the value", () => {
    expect(databaseRefusal(duplicateId)).toEqual({
      category: "conflict",
      message: 'A record with this "id" already exists.',
      reason: expect.any(Object)
    });
  });

  it("names the reference that matches nothing", () => {
    expect(databaseRefusal(missingProcedure)).toEqual({
      category: "conflict",
      message: '"procedureId" does not match an existing "procedure".',
      reason: expect.any(Object)
    });
  });

  it("says what still uses a record that cannot be deleted", () => {
    expect(
      databaseRefusal({
        code: "23503",
        detail: 'Key (id)=(x) is still referenced from table "jobMaterial".'
      })?.message
    ).toBe('It is still used by a "jobMaterial" record; remove that first.');
  });

  it("passes a trigger's own text through under its constraint code's category", () => {
    const message =
      'Cannot delete unit of measure "KG" because it is in use: jobMaterial (2)';
    expect(databaseRefusal({ code: "23503", message, details: null })).toEqual({
      category: "conflict",
      message,
      reason: { code: "raw", values: { text: message } }
    });
  });

  it("names a missing required column, from PostgREST or node-postgres", () => {
    const message =
      'null value in column "processId" of relation "jobOperation" violates not-null constraint';
    expect(databaseRefusal({ code: "23502", message })?.message).toBe(
      '"processId" is required.'
    );
    expect(
      databaseRefusal({ code: "23502", message, column: "processId" })
    ).toEqual({
      category: "validation",
      message: '"processId" is required.',
      reason: expect.any(Object)
    });
  });

  it("passes a bad value's own message through as a validation error", () => {
    expect(
      databaseRefusal({
        code: "22P02",
        message: 'invalid input value for enum "factor": "Hours"'
      })
    ).toEqual({
      category: "validation",
      message: 'Invalid input value for enum "factor": "Hours".',
      reason: expect.any(Object)
    });
  });

  it("finds a driver error wrapped one cause deep", () => {
    expect(
      databaseRefusal(new Error("wrapped", { cause: duplicateId }))?.category
    ).toBe("conflict");
  });

  it("leaves failures the caller cannot fix alone", () => {
    expect(databaseRefusal({ code: "08006", message: "connection" })).toBe(
      null
    );
    expect(databaseRefusal(new Error("boom"))).toBe(null);
    expect(databaseRefusal(null)).toBe(null);
  });
});

describe("a service function's database refusal", () => {
  const ctx = createServiceContext({
    actor: { type: "system", onBehalfOf: "user-1" },
    company: { id: "c1", groupId: "g1" },
    caller: {} as never,
    system: () => ({}) as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });

  it("is reported as the refusal, after the operation's own message", async () => {
    const create = defineServiceFn({
      input: z.object({}),
      permission: {},
      async run(ctx) {
        return ctx.error(
          "internal",
          "Failed to insert job operation",
          duplicateId
        );
      }
    });
    const { error } = await create(ctx, {});
    expect(error).toMatchObject({
      category: "conflict",
      status: 409,
      message:
        'Failed to insert job operation: A record with this "id" already exists.'
    });
  });

  it("is reported as the refusal when the driver throws it", async () => {
    const create = defineServiceFn({
      input: z.object({}),
      permission: {},
      async run() {
        throw Object.assign(new Error("fk"), missingProcedure);
      }
    });
    const { error } = await create(ctx, {});
    expect(error).toMatchObject({ category: "conflict", status: 409 });
  });

  it("keeps any other internal failure internal", async () => {
    const create = defineServiceFn({
      input: z.object({}),
      permission: {},
      async run(ctx) {
        return ctx.error("internal", "Failed", new Error("timeout"));
      }
    });
    const { error } = await create(ctx, {});
    expect(error).toMatchObject({ category: "internal", message: "Failed" });
  });
});
