// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { InvalidInputError, ServerFnError, toServerFnError } from "./errors";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));

const toError = (err: unknown) => toServerFnError("test", err);

describe("toServerFnError", () => {
  it("surfaces an authored message at the default status", () => {
    const error = toError(new Error("Tracked entity not found"));
    expect(error.message).toBe("Tracked entity not found");
    expect(error.status).toBe(500);
  });

  it("hides a node-postgres error's text", () => {
    const error = toError(
      Object.assign(
        new Error('duplicate key value violates "receiptLine_pkey"'),
        {
          code: "23505",
          severity: "ERROR"
        }
      )
    );
    expect(error.message).toBe("");
  });

  it("hides a PostgREST error's text", () => {
    const error = toError({
      code: "42501",
      details: null,
      hint: null,
      message: "permission denied for table x"
    });
    expect(error.message).toBe("");
  });

  it("turns a zod error into a 400 naming the fields", () => {
    const parsed = z.object({ qty: z.number() }).safeParse({ qty: "a" });
    const error = toError(parsed.error);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error.message).toMatch(/^Invalid input — qty: /);
  });

  it("keeps a thrown error's own HTTP status", () => {
    const error = toError(
      Object.assign(new Error("Location not found"), { status: 404 })
    );
    expect(error.status).toBe(404);
  });

  it("passes a ServerFnError through with its body", () => {
    const thrown = new InvalidInputError("Some lines are invalid", {
      invalidLineIds: ["l1"]
    });
    expect(toError(thrown)).toBe(thrown);
    expect(thrown).toBeInstanceOf(ServerFnError);
    expect(thrown.body).toEqual({ invalidLineIds: ["l1"] });
  });
});
