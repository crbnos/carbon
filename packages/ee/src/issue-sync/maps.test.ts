// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { hashText } from "./maps";

describe("hashText", () => {
  it("returns null for no value", () => {
    expect(hashText(null)).toBeNull();
    expect(hashText(undefined)).toBeNull();
  });

  it("gives the same hash for the same JSON and a different one otherwise", () => {
    const doc = { type: "doc", content: [{ type: "text", text: "a" }] };
    expect(hashText(doc)).toBe(hashText(structuredClone(doc)));
    expect(hashText(doc)).not.toBe(
      hashText({ type: "doc", content: [{ type: "text", text: "b" }] })
    );
    expect(hashText("# Title")).toMatch(/^[0-9a-f]{8}$/);
  });
});
