// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { importTypeScript } from "./sandbox";

describe("importTypeScript", () => {
  it("runs a typed rule body", async () => {
    const mod = await importTypeScript(
      "const qty: number = params.qty;\nreturn qty * 2;"
    );
    expect(await mod.configure<number>({ qty: 21 })).toBe(42);
  });

  it("yields null for a rule that does not compile", async () => {
    const mod = await importTypeScript("return (;");
    expect(await mod.configure({})).toBeNull();
  });

  it("yields null for a rule with a type-level syntax error", async () => {
    const mod = await importTypeScript("const qty: = params.qty;\nreturn qty;");
    expect(await mod.configure({ qty: 1 })).toBeNull();
  });

  it("yields null for a rule that throws", async () => {
    const mod = await importTypeScript('throw new Error("nope");');
    expect(await mod.configure({})).toBeNull();
  });
});
