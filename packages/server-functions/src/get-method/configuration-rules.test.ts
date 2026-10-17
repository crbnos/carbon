// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { remapRuleField, ruleFieldReferences } from "./configuration-rules";

// A version copy: method m1 → m2, material a → b, operation x → y.
const idMap = new Map([
  ["m1", "m2"],
  ["a", "b"],
  ["x", "y"]
]);

describe("remapRuleField", () => {
  it("re-keys a line field rule onto the copied line", () => {
    expect(remapRuleField("quantity:a", idMap)).toBe("quantity:b");
    expect(remapRuleField("laborTime:x", idMap)).toBe("laborTime:y");
  });

  it("re-keys the root list rule onto the new method", () => {
    expect(remapRuleField("billOfMaterial:m1:undefined", idMap)).toBe(
      "billOfMaterial:m2:undefined"
    );
  });

  it("re-keys a sub-assembly list rule by its line, keeping the child's method", () => {
    // The child item's method is not copied; the line that uses it is.
    expect(remapRuleField("billOfProcess:child:a", idMap)).toBe(
      "billOfProcess:child:b"
    );
  });

  it("leaves rules of rows that were not copied", () => {
    expect(remapRuleField("quantity:other", idMap)).toBeNull();
    expect(remapRuleField("billOfMaterial:child:other", idMap)).toBeNull();
  });
});

describe("ruleFieldReferences", () => {
  it("finds the rules of replaced rows by any id in the field", () => {
    const replaced = new Set(["old-line"]);
    expect(ruleFieldReferences("quantity:old-line", replaced)).toBe(true);
    expect(ruleFieldReferences("billOfMaterial:child:old-line", replaced)).toBe(
      true
    );
    expect(ruleFieldReferences("quantity:kept-line", replaced)).toBe(false);
  });
});
