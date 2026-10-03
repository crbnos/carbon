// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { runConfigurationRule, transpileRule } from "./configuration-rule";

describe("transpileRule", () => {
  it("wraps the body in configure and strips its types", async () => {
    const javascript = transpileRule(
      "const qty: number = params.qty as number;\nreturn qty * 2;"
    );
    expect(javascript).not.toMatch(/: number|as number|: Params/);
    expect(await runConfigurationRule(javascript, { qty: 21 })).toBe(42);
  });

  it("throws on a syntax error", () => {
    expect(() => transpileRule("return (;")).toThrow();
  });
});

describe("runConfigurationRule", () => {
  const rule = (body: string) => `function configure(params) {\n${body}\n}`;

  it("returns what configure returns, from the params it is given", async () => {
    expect(
      await runConfigurationRule(
        rule(`return params.width > 10 ? ["A", params.name] : ["B"];`),
        { width: 12, name: "wide" }
      )
    ).toEqual(["A", "wide"]);
    expect(
      await runConfigurationRule(rule("return params.material.gradeId;"), {
        material: { gradeId: "steel-a36" }
      })
    ).toEqual("steel-a36");
  });

  it("no return, or undefined, is null", async () => {
    expect(await runConfigurationRule(rule(""), {})).toBeNull();
    expect(
      await runConfigurationRule(rule("return undefined;"), {})
    ).toBeNull();
  });

  it("the rule sees none of the host: no network, timers, process or module loading", async () => {
    const seen = await runConfigurationRule(
      rule(`return [
        typeof Deno, typeof fetch, typeof setTimeout, typeof process, typeof require,
        typeof XMLHttpRequest, typeof WebSocket, typeof window, typeof __params
      ];`),
      {}
    );
    expect(seen).toEqual([
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "undefined",
      "string"
    ]);
    // The Function constructor exists, but only builds more QuickJS code.
    await expect(
      runConfigurationRule(
        rule(
          `return (0, globalThis.constructor.constructor)("return process")();`
        ),
        {}
      )
    ).rejects.toThrow("'process' is not defined");
    // Promise jobs never run, so nothing asynchronous (a dynamic import included) completes.
    expect(
      await runConfigurationRule(
        rule(`let state = "sync";
          import("https://example.com/x.js").then(() => { state = "loaded"; }, () => { state = "failed"; });
          Promise.resolve().then(() => { state = "async"; });
          return state;`),
        {}
      )
    ).toEqual("sync");
  });

  it("a runaway rule is stopped by the time, memory and stack limits", async () => {
    await expect(
      runConfigurationRule(rule("while (true) {}"), {})
    ).rejects.toThrow("interrupted");
    // Stopped by the memory limit itself, not by the time limit catching up.
    for (const allocate of [
      `"x".repeat(1e5)`,
      "new Array(1e4).fill(1)",
      "new ArrayBuffer(1e6)"
    ]) {
      await expect(
        runConfigurationRule(
          rule(`const a = []; while (true) a.push(${allocate});`),
          {}
        )
      ).rejects.toThrow("out of memory");
    }
    await expect(
      runConfigurationRule(rule("const f = () => f(); return f();"), {})
    ).rejects.toThrow();
  });

  it("a throwing rule rejects, and does not break the next run", async () => {
    await expect(
      runConfigurationRule(rule(`throw new Error("bad");`), {})
    ).rejects.toThrow();
    expect(await runConfigurationRule(rule("return 1 + 1;"), {})).toEqual(2);
  });

  it("one run cannot leave state for the next", async () => {
    await runConfigurationRule(rule("globalThis.leak = 42; return null;"), {});
    expect(await runConfigurationRule(rule("return typeof leak;"), {})).toEqual(
      "undefined"
    );
  });
});
