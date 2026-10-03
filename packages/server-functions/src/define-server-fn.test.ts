// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineServerFn } from "./define-server-fn";
import { InvalidInputError, NotFoundError, ServerFnError } from "./errors";
import { ServerFnContext } from "./server-fn-context";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));

// Never queried: every case below is decided before `get_claims` would run.
const fields = {
  db: {} as Kysely<KyselyDatabase>,
  companyId: "co1",
  userId: "u1"
};
const system = ServerFnContext.system(fields);
const user = ServerFnContext.user(fields);

const echo = defineServerFn({
  name: "echo",
  input: z.object({ value: z.number().default(1) }),
  permissions: "system",
  async run(ctx, { value }) {
    return { value, companyId: ctx.companyId };
  }
});

describe("defineServerFn", () => {
  it("runs with the parsed input and returns { data, error: null }", async () => {
    expect(await echo(system, {})).toEqual({
      data: { value: 1, companyId: "co1" },
      error: null
    });
  });

  it("returns invalid input as a 400 naming the field, without running", async () => {
    const run = vi.fn();
    const fn = defineServerFn({
      name: "strict",
      input: z.object({ id: z.string() }),
      permissions: "system",
      run
    });
    const { error } = await fn(system, { id: 1 } as never);
    expect(error).toBeInstanceOf(InvalidInputError);
    expect(error?.status).toBe(400);
    expect(error?.message).toMatch(/^Invalid input — id: /);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a user when the function is system-only", async () => {
    const { error } = await echo(user, {});
    expect(error?.status).toBe(403);
  });

  it("passes a ServerFnError through with its status and body", async () => {
    const fn = defineServerFn({
      name: "missing",
      input: z.object({}),
      permissions: "system",
      async run() {
        throw new NotFoundError("Receipt not found");
      }
    });
    const { error } = await fn(system, {});
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error?.status).toBe(404);
    expect(error?.message).toBe("Receipt not found");
  });

  it("hides a data-layer message and uses defaultStatus", async () => {
    const fn = defineServerFn({
      name: "db",
      input: z.object({}),
      permissions: "system",
      defaultStatus: 400,
      async run() {
        throw {
          code: "23505",
          severity: "ERROR",
          message: 'duplicate key value violates unique constraint "x_pkey"'
        };
      }
    });
    const { error } = await fn(system, {});
    expect(error).toBeInstanceOf(ServerFnError);
    expect(error?.message).toBe("");
    expect(error?.status).toBe(400);
  });
});
