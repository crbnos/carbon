// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSWASMModule
} from "quickjs-emscripten-core";

/**
 * Configuration rules are code a company writes, so they never run in the host JavaScript
 * engine (the edge function or the browser). They run in QuickJS, a separate engine
 * compiled to WebAssembly: its globals are the language built-ins only — no network, no
 * environment, no timers, no host objects — and each run gets its own memory, stack and
 * time limits. The only way in is `params` as JSON, and the only way out is the JSON
 * value `configure` returns. Used by get-method (Deno) and the rule editor (browser).
 */

const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
const TIME_LIMIT_MS = 500;

let engine: Promise<QuickJSWASMModule> | undefined;

/**
 * Run JavaScript that defines `function configure(params)` and return its result. Throws
 * when the code fails, exceeds a limit, or returns something JSON cannot carry.
 */
export async function runConfigurationRule(
  javascript: string,
  params: unknown
): Promise<unknown> {
  engine ??= newQuickJSWASMModuleFromVariant(variant);
  const runtime = (await engine).newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(STACK_LIMIT_BYTES);
  const deadline = performance.now() + TIME_LIMIT_MS;
  runtime.setInterruptHandler(() => performance.now() > deadline);

  const context = runtime.newContext();
  try {
    const input = context.newString(JSON.stringify(params ?? null));
    context.setProp(context.global, "__params", input);
    input.dispose();

    const output = context.unwrapResult(
      context.evalCode(
        `${javascript}\n;JSON.stringify(configure(JSON.parse(__params)) ?? null) ?? "null";`
      )
    );
    const json = context.typeof(output) === "string" ? context.getString(output) : "null";
    output.dispose();
    return JSON.parse(json);
  } finally {
    context.dispose();
    runtime.dispose();
  }
}
