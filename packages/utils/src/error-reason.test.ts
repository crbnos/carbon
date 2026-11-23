// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  databaseReason,
  describeCause,
  NOT_APPLIED_CODE,
  NOT_APPLIED_TEXT,
  reasonText
} from "./error-reason";

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

function textOf(error: unknown): string | null {
  const reason = databaseReason(error);
  return reason ? reasonText(reason) : null;
}

describe("reasonText of a database refusal", () => {
  it("names the duplicate key, without the company or the value", () => {
    expect(textOf(duplicateId)).toBe('A record with this "id" already exists.');
    expect(textOf({ code: "23505" })).toBe(
      "A record with these values already exists."
    );
  });

  it("names the reference that matches nothing", () => {
    expect(textOf(missingProcedure)).toBe(
      '"procedureId" does not match an existing "procedure".'
    );
    expect(textOf({ code: "23503" })).toBe(
      "A referenced record does not exist."
    );
  });

  it("says what still uses a record that cannot be deleted", () => {
    expect(
      textOf({
        code: "23503",
        detail: 'Key (id)=(x) is still referenced from table "jobMaterial".'
      })
    ).toBe('It is still used by a "jobMaterial" record; remove that first.');
  });

  it("keeps a trigger's own text when it raised a constraint code", () => {
    // Row-level security hides the detail, so the stock sentence would be a guess.
    const inUse = {
      code: "23503",
      message:
        'Cannot delete unit of measure "KG" because it is in use: jobMaterial (2)',
      details: null
    };
    expect(databaseReason(inUse)).toEqual({
      code: "raw",
      values: { text: inUse.message }
    });
  });

  it("names a missing required column, from PostgREST or node-postgres", () => {
    const message =
      'null value in column "processId" of relation "jobOperation" violates not-null constraint';
    expect(textOf({ code: "23502", message })).toBe('"processId" is required.');
    expect(textOf({ code: "23502", message, column: "processId" })).toBe(
      '"processId" is required.'
    );
    expect(textOf({ code: "23502" })).toBe("A required field was missing.");
  });

  it("names the check constraint", () => {
    expect(
      textOf({
        code: "23514",
        message:
          'new row for relation "x" violates check constraint "x_qty_check"'
      })
    ).toBe('The values break the rule "x_qty_check".');
    expect(textOf({ code: "23514" })).toBe(
      "The values break a rule on this record."
    );
  });

  it("passes a bad value's own message through", () => {
    expect(
      textOf({
        code: "22P02",
        message: 'invalid input value for enum "factor": "Hours"'
      })
    ).toBe('Invalid input value for enum "factor": "Hours".');
    expect(textOf({ code: "22001" })).toBe("A value is not valid.");
  });

  it("maps permission and not-found", () => {
    expect(textOf({ code: "42501" })).toBe(
      "You do not have permission to do this"
    );
    expect(textOf({ code: "PGRST116" })).toBe("No matching record was found.");
  });

  it("finds a driver error wrapped one cause deep", () => {
    expect(
      databaseReason(new Error("wrapped", { cause: duplicateId }))?.code
    ).toBe("duplicate");
  });

  it("leaves failures the caller cannot fix alone", () => {
    expect(databaseReason({ code: "08006", message: "connection" })).toBe(null);
    expect(databaseReason(new Error("boom"))).toBe(null);
    expect(databaseReason(null)).toBe(null);
  });
});

describe("describeCause", () => {
  it("has nothing to say without a cause", () => {
    expect(describeCause(null)).toBe(null);
    expect(describeCause(undefined)).toBe(null);
    expect(describeCause("")).toBe(null);
    expect(describeCause(42)).toBe(null);
  });

  it("ignores a value that is not an error", () => {
    expect(describeCause({ orderId: "PO-1" })).toBe(null);
  });

  it("reads a string as raw text, cut to 300 characters", () => {
    expect(describeCause("Storage is full")).toEqual({
      code: "raw",
      values: { text: "Storage is full" }
    });
    const text = describeCause("x".repeat(400))?.values.text ?? "";
    expect(text).toHaveLength(300);
    expect(text.endsWith("…")).toBe(true);
  });

  it("returns the reason a failed result already carries", () => {
    const reason = { code: "duplicate" as const, values: {} };
    expect(describeCause({ success: false, message: "x", reason })).toBe(
      reason
    );
  });

  it("reads a service error's message when it carries no reason", () => {
    expect(
      describeCause({
        category: "rule",
        message: "The order is locked",
        status: 422
      })
    ).toEqual({ code: "raw", values: { text: "The order is locked" } });
  });

  it("reads a write that changed no row", () => {
    expect(
      describeCause({ code: NOT_APPLIED_CODE, message: NOT_APPLIED_TEXT })
    ).toEqual({ code: "notApplied", values: {} });
  });

  it("shows the text of a RAISE in our SQL", () => {
    const message = "Accounting period is closed for posting date 2026-10-01";
    expect(describeCause({ code: "P0001", message })).toEqual({
      code: "raw",
      values: { text: message }
    });
    expect(describeCause({ code: "55000", message: "Locked" })).toEqual({
      code: "raw",
      values: { text: "Locked" }
    });
  });

  it("prefers a RAISE's own text over the code's generic one", () => {
    expect(
      describeCause({ code: "23514", message: "Quantity must be positive" })
    ).toEqual({ code: "raw", values: { text: "Quantity must be positive" } });
    expect(
      describeCause({
        code: "23514",
        message:
          'new row for relation "x" violates check constraint "x_qty_check"',
        constraint: "x_qty_check"
      })
    ).toEqual({ code: "breaksRule", values: { constraint: "x_qty_check" } });
    expect(
      describeCause({ code: "42501", message: "permission denied for table x" })
    ).toEqual({ code: "forbidden", values: {} });
  });

  it("maps a known database refusal", () => {
    expect(describeCause(duplicateId)).toEqual({
      code: "duplicate",
      values: { columns: '"id"' }
    });
  });

  it("summarizes a zod error", () => {
    expect(
      describeCause({
        name: "ZodError",
        issues: [{ path: ["quantity"], message: "Required" }]
      })
    ).toEqual({
      code: "raw",
      values: { text: "Invalid input — quantity: Required" }
    });
  });

  it("shows an exception's or an unknown database error's message", () => {
    expect(describeCause(new Error("boom"))).toEqual({
      code: "raw",
      values: { text: "boom" }
    });
    expect(
      describeCause({ code: "08006", message: "connection refused" })
    ).toEqual({ code: "raw", values: { text: "connection refused" } });
    expect(describeCause(new Error(""))).toBe(null);
  });

  it("shows the message of an error a building block wrote by hand", () => {
    expect(describeCause({ message: "Inspection plan not found" })).toEqual({
      code: "raw",
      values: { text: "Inspection plan not found" }
    });
    // A class instance with a message is a value, not an error.
    class Note {
      message = "remember to reorder";
    }
    expect(describeCause(new Note())).toBe(null);
  });
});
