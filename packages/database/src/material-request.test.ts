// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { createMaterialRequest } from "./material-request.ts";

describe("createMaterialRequest", () => {
  it("refuses a request with neither an item nor a note, before any read", async () => {
    const client = {
      from() {
        throw new Error("no query expected");
      }
    };

    for (const note of [null, "", "   "]) {
      const result = await createMaterialRequest(client as never, {
        companyId: "company-1",
        userId: "user-1",
        jobOperationId: "op-1",
        itemId: null,
        note
      });
      expect(result).toEqual({ data: null, error: "Describe what you need" });
    }
  });
});
