// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { NOT_APPLIED_CODE } from "./error-reason";
import { requireAffected } from "./require-affected";

describe("requireAffected", () => {
  it("refuses a write that changed no row", async () => {
    const result = await requireAffected(
      Promise.resolve({ data: [], error: null })
    );
    expect(result.error).toMatchObject({ code: NOT_APPLIED_CODE });
  });

  it("passes a write that changed a row", async () => {
    const written = { data: [{ id: "a" }], error: null };
    expect(await requireAffected(Promise.resolve(written))).toEqual(written);
  });

  it("keeps the error of a write that failed", async () => {
    const failed = { data: null, error: { code: "23505", message: "dup" } };
    expect(await requireAffected(Promise.resolve(failed))).toEqual(failed);
  });
});
