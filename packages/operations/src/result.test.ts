import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OperationError, runOperation } from "./result";

const fail = (err: unknown) =>
  runOperation("test", async () => {
    throw err;
  });

describe("runOperation", () => {
  it("returns the value on success", async () => {
    expect(await runOperation("test", async () => 42)).toEqual({
      data: 42,
      error: null
    });
  });

  it("surfaces an authored message", async () => {
    const { error } = await fail(new Error("Tracked entity not found"));
    expect(error?.message).toBe("Tracked entity not found");
    expect(error?.status).toBe(500);
  });

  it("hides a node-postgres error's text", async () => {
    const { error } = await fail(
      Object.assign(
        new Error('duplicate key value violates "receiptLine_pkey"'),
        {
          code: "23505",
          severity: "ERROR"
        }
      )
    );
    expect(error?.message).toBe("");
  });

  it("hides a PostgREST error's text", async () => {
    const { error } = await fail({
      code: "42501",
      details: null,
      hint: null,
      message: "permission denied for table x"
    });
    expect(error?.message).toBe("");
  });

  it("summarises a zod error instead of dumping it", async () => {
    const parsed = z.object({ qty: z.number() }).safeParse({ qty: "a" });
    const { error } = await fail(parsed.error);
    expect(error?.message).toMatch(/^Invalid payload — qty: /);
  });

  it("keeps an error's HTTP status and structured body", async () => {
    const notFound = Object.assign(new Error("Location not found"), {
      status: 404
    });
    expect((await fail(notFound)).error?.status).toBe(404);

    const withBody = new OperationError("Some lines are invalid", 400, {
      invalidLineIds: ["l1"]
    });
    const { error } = await fail(withBody);
    expect(error?.status).toBe(400);
    expect(error?.body).toEqual({ invalidLineIds: ["l1"] });
  });
});
