// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  databaseRefusal,
  withCallerValues,
  withConstraintColumns
} from "./database-refusal";
import {
  createServiceContext,
  defineServiceFn,
  refusalDetail
} from "./service-fn.server";

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

// Under row-level security Postgres leaves the key out of the detail.
const hiddenUnit = {
  code: "23503",
  message:
    'insert or update on table "item" violates foreign key constraint "item_unitOfMeasureCode_fkey"',
  details: 'Key is not present in table "unitOfMeasure".'
};
const hiddenDuplicate = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "item_unique"',
  details: null
};

// Answers the one catalog query `withConstraintColumns` makes.
function catalog(rows: { column_name: string; table_name: string }[]) {
  const where: unknown[][] = [];
  const query = {
    select: () => query,
    where: (...args: unknown[]) => {
      where.push(args);
      return query;
    },
    orderBy: () => query,
    execute: async () => rows
  };
  const pg = { withSchema: () => ({ selectFrom: () => query }) };
  return { pg: () => pg as never, where };
}

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

  it("withholds an internal message that is the cause's own text", async () => {
    const missingTable = {
      code: "42P01",
      message: 'relation "secretTable" does not exist'
    };
    const read = defineServiceFn({
      input: z.object({}),
      permission: {},
      async run(ctx) {
        return ctx.error("internal", missingTable.message, missingTable);
      }
    });
    const { error } = await read(ctx, {});
    expect(error).toMatchObject({
      category: "internal",
      message: "Something went wrong"
    });
  });

  it("keeps an internal message's own words and drops the cause's text after them", async () => {
    const missingTable = {
      code: "42P01",
      message: 'relation "secretTable" does not exist'
    };
    const apply = defineServiceFn({
      input: z.object({}),
      permission: {},
      async run(ctx) {
        return ctx.error(
          "internal",
          `Failed to apply planning actions: ${missingTable.message}`,
          missingTable
        );
      }
    });
    const { error } = await apply(ctx, {});
    expect(error).toMatchObject({
      category: "internal",
      message: "Failed to apply planning actions"
    });
  });

  it("names a refusal without Postgres' sentence when the message is the cause's text", async () => {
    const create = defineServiceFn({
      input: z.object({}),
      permission: {},
      async run(ctx) {
        return ctx.error("internal", duplicateId.message, duplicateId);
      }
    });
    const { error } = await create(ctx, {});
    expect(error?.category).toBe("conflict");
    expect(error?.message).not.toContain("duplicate key value");
  });
});

describe("a refusal Postgres withheld the key from", () => {
  it("keeps the constraint and table to look the columns up by", () => {
    expect(databaseRefusal(hiddenUnit)?.reason).toEqual({
      code: "noMatch",
      values: {
        target: "unitOfMeasure",
        constraint: "item_unitOfMeasureCode_fkey",
        table: "item"
      }
    });
    expect(databaseRefusal(hiddenDuplicate)?.reason).toEqual({
      code: "duplicate",
      values: { constraint: "item_unique" }
    });
  });

  it("names the constraint's columns, without the company", async () => {
    const { pg, where } = catalog([
      { column_name: "unitOfMeasureCode", table_name: "item" },
      { column_name: "companyId", table_name: "item" }
    ]);
    const named = await withConstraintColumns(databaseRefusal(hiddenUnit)!, pg);
    expect(named.message).toBe(
      '"unitOfMeasureCode" does not match an existing "unitOfMeasure".'
    );
    expect(where).toContainEqual(["table_name", "=", "item"]);
  });

  it("stays as it was when the lookup fails", async () => {
    const refusal = databaseRefusal(hiddenDuplicate)!;
    await expect(
      withConstraintColumns(refusal, () => ({}) as never)
    ).resolves.toBe(refusal);
  });

  it("adds the record and the value the caller sent", () => {
    const refusal = withCallerValues(databaseRefusal(missingProcedure)!, {
      id: "OP-1",
      procedureId: "p-404"
    });
    expect(refusal.reason.values).toMatchObject({
      record: "OP-1",
      value: "p-404"
    });
  });
});

describe("a service function's refusal, named", () => {
  const ctx = createServiceContext({
    actor: { type: "system", onBehalfOf: "user-1" },
    company: { id: "c1", groupId: "g1" },
    caller: {} as never,
    system: () => ({}) as never,
    pg: catalog([{ column_name: "unitOfMeasureCode", table_name: "item" }]).pg,
    kv: () => ({}) as never
  });

  it("names the record, the field and the value in the message and the detail", async () => {
    const create = defineServiceFn({
      input: z.object({ id: z.string(), unitOfMeasureCode: z.string() }),
      permission: {},
      async run(ctx) {
        return ctx.error("internal", "Failed to insert part", hiddenUnit);
      }
    });
    const { error } = await create(ctx, {
      id: "PART-1",
      unitOfMeasureCode: "NOPE"
    });
    expect(error).toMatchObject({
      category: "conflict",
      message:
        'Failed to insert part "PART-1": "unitOfMeasureCode" does not match an existing "unitOfMeasure" (value "NOPE").'
    });
    expect(refusalDetail(error!)).toMatchObject({
      title: "Failed to insert part",
      field: "unitOfMeasureCode",
      fields: ["unitOfMeasureCode"],
      value: "NOPE",
      record: "PART-1"
    });
  });
});
