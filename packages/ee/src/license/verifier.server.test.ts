// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { licenceRoots } from "./roots";
import { EMPTY_STATE } from "./types";
import { verify } from "./verifier.server";

describe("WebAssembly verifier", () => {
  it("loads and refuses a string that is not a licence", async () => {
    const out = await verify({
      license: "crbn.v1.not-a-licence",
      roots: licenceRoots(),
      state: EMPTY_STATE,
      now: "2026-11-12T00:00:00Z",
      context: "install"
    });
    expect(out.ok).toBe(false);
    expect(out.ok ? null : out.error).toMatch(/^ERR_/);
  });
});
