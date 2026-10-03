// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { serverFns } from "./invoke";

vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));

// Never queried: both cases are decided before the function touches the database.
const fields = {
  db: {} as Kysely<KyselyDatabase>,
  companyId: "co1",
  userId: "u1"
};

describe("serverFns", () => {
  it("returns the function's own refusal as { data, error }", async () => {
    const result = await serverFns
      .system(fields)
      .invoke("post-receipt", { receiptId: 1 } as never);
    expect(result.data).toBeNull();
    expect(result.error?.status).toBe(400);
  });

  it("invokeOrThrow throws that error", async () => {
    await expect(
      serverFns
        .system(fields)
        .invokeOrThrow("post-receipt", { receiptId: 1 } as never)
    ).rejects.toMatchObject({ status: 400 });
  });
});
