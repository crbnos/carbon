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

  it("surfaces a message raised by our own SQL", () => {
    const message =
      "Job J000343 has 6 serial unit(s) left to receive, fewer than the 15 being completed";
    const error = toServerFnError(
      "test",
      Object.assign(new Error(message), { code: "P0001", severity: "ERROR" }),
      400
    );
    expect(error.message).toBe(message);
    expect(error.status).toBe(400);
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

  it("withholds a programming error's message", () => {
    for (const thrown of [
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new ReferenceError("row is not defined"),
      new RangeError("Invalid array length"),
      new SyntaxError("Unexpected token")
    ]) {
      const error = toError(thrown);
      expect(error.message).toBe("");
      expect(error.status).toBe(500);
    }
  });

  it("withholds a database or network failure's text, as a 500 whatever the default", () => {
    const connectionRefused = Object.assign(
      new Error("connect ECONNREFUSED 10.0.0.5:5432"),
      { code: "ECONNREFUSED", errno: -111, syscall: "connect" }
    );
    const noResult = Object.assign(new Error("no result"), { node: {} });
    for (const thrown of [
      connectionRefused,
      new AggregateError([connectionRefused], ""),
      new Error("timeout exceeded when trying to connect"),
      new Error("Connection terminated unexpectedly"),
      Object.assign(new Error("sorry, too many clients already"), {
        code: "53300",
        severity: "FATAL"
      }),
      noResult
    ]) {
      const error = toServerFnError("test", thrown, 400);
      expect(error).toMatchObject({ message: "", status: 500 });
    }
    expect(
      toServerFnError("test", new Error("Not enough stock"), 400)
    ).toMatchObject({
      message: "Not enough stock",
      status: 400
    });
  });

  it("withholds the message of a thrown 5xx, keeping its status and body", () => {
    const thrown = new ServerFnError("Journal out of balance by 0.02", 500, {
      journalId: "j1"
    });
    const error = toError(thrown);
    expect(error).toMatchObject({ message: "", status: 500 });
    expect(error.body).toEqual({ journalId: "j1" });
    expect(
      toError(Object.assign(new Error("Upstream down"), { status: 503 }))
    ).toMatchObject({ message: "", status: 503 });
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
