// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  assertEquals,
  assertRejects
} from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { runConfigurationRule } from "./configuration-rule.ts";

const rule = (body: string) => `function configure(params) {\n${body}\n}`;

Deno.test("returns what configure returns, from the params it is given", async () => {
  assertEquals(
    await runConfigurationRule(
      rule(`return params.width > 10 ? ["A", params.name] : ["B"];`),
      { width: 12, name: "wide" }
    ),
    ["A", "wide"]
  );
  assertEquals(await runConfigurationRule(rule("return params.material.gradeId;"), {
    material: { gradeId: "steel-a36" }
  }), "steel-a36");
});

Deno.test("no return, or undefined, is null", async () => {
  assertEquals(await runConfigurationRule(rule(""), {}), null);
  assertEquals(await runConfigurationRule(rule("return undefined;"), {}), null);
});

Deno.test("the rule sees none of the host: no Deno, network, timers, process or module loading", async () => {
  const seen = await runConfigurationRule(
    rule(`return [
      typeof Deno, typeof fetch, typeof setTimeout, typeof process, typeof require,
      typeof XMLHttpRequest, typeof WebSocket, typeof window, typeof __params
    ];`),
    {}
  );
  assertEquals(seen, [
    "undefined", "undefined", "undefined", "undefined", "undefined",
    "undefined", "undefined", "undefined", "string"
  ]);
  // The Function constructor exists, but only builds more QuickJS code.
  await assertRejects(
    () =>
      runConfigurationRule(
        rule(`return (0, globalThis.constructor.constructor)("return Deno")();`),
        {}
      ),
    Error,
    "'Deno' is not defined"
  );
  // Promise jobs never run, so nothing asynchronous (a dynamic import included) completes.
  assertEquals(
    await runConfigurationRule(
      rule(`let state = "sync";
        import("https://example.com/x.js").then(() => { state = "loaded"; }, () => { state = "failed"; });
        Promise.resolve().then(() => { state = "async"; });
        return state;`),
      {}
    ),
    "sync"
  );
});

Deno.test("a runaway rule is stopped by the time, memory and stack limits", async () => {
  await assertRejects(() => runConfigurationRule(rule("while (true) {}"), {}));
  await assertRejects(() =>
    runConfigurationRule(rule(`const a = []; while (true) a.push("x".repeat(1e5));`), {})
  );
  await assertRejects(() =>
    runConfigurationRule(rule("const f = () => f(); return f();"), {})
  );
});

Deno.test("a throwing rule rejects, and does not break the next run", async () => {
  await assertRejects(() => runConfigurationRule(rule(`throw new Error("bad");`), {}));
  assertEquals(await runConfigurationRule(rule("return 1 + 1;"), {}), 2);
});

Deno.test("one run cannot leave state for the next", async () => {
  await runConfigurationRule(rule("globalThis.leak = 42; return null;"), {});
  assertEquals(await runConfigurationRule(rule("return typeof leak;"), {}), "undefined");
});
