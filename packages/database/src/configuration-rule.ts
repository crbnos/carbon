// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant
} from "quickjs-emscripten-core";
import { transform } from "sucrase";

/**
 * Configuration rules are code a company writes, so they never run in the host JavaScript
 * engine (the server or the browser). They run in QuickJS, a separate engine compiled to
 * WebAssembly: its globals are the language built-ins only — no network, no environment,
 * no timers, no host objects — and each run gets its own memory, stack and time limits.
 * The only way in is `params` as JSON, and the only way out is the JSON value `configure`
 * returns. Used by get-method and the rule editor, so a preview and a job run the same
 * JavaScript.
 */

const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const STACK_LIMIT_BYTES = 512 * 1024;
const TIME_LIMIT_MS = 500;
/** The WebAssembly memory the engine starts with, before a rule allocates anything. */
const ENGINE_BYTES = 16 * 1024 * 1024;
const WASM_PAGE_BYTES = 64 * 1024;

/**
 * Each run gets its own WebAssembly instance, over a memory that cannot grow past the
 * limit. QuickJS's own memory limit does not bound the heap of a WebAssembly build, a
 * WebAssembly memory never shrinks, and the interrupt handler is polled too rarely to
 * stop a rule that allocates in a loop — on one shared instance a single rule could
 * take hundreds of megabytes and keep them. Instantiating is a millisecond or two.
 */
const newEngine = () =>
  newQuickJSWASMModuleFromVariant(
    newVariant(variant, {
      wasmMemory: new WebAssembly.Memory({
        initial: ENGINE_BYTES / WASM_PAGE_BYTES,
        maximum: (ENGINE_BYTES + MEMORY_LIMIT_BYTES) / WASM_PAGE_BYTES
      })
    })
  );

/**
 * Run JavaScript that defines `function configure(params)` and return its result. Throws
 * when the code fails, exceeds a limit, or returns something JSON cannot carry.
 */
export async function runConfigurationRule(
  javascript: string,
  params: unknown
): Promise<unknown> {
  const runtime = (await newEngine()).newRuntime();
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
    const json =
      context.typeof(output) === "string" ? context.getString(output) : "null";
    output.dispose();
    return JSON.parse(json);
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

/**
 * A stored rule is the TypeScript body of `configure(params)`. Wrap it and strip the
 * types — the one transpile both the rule editor and get-method run, so a preview and
 * a job see the same JavaScript. Throws on a syntax error.
 */
export function transpileRule(code: string): string {
  return transform(`function configure(params: Params) {\n${code}\n}`, {
    transforms: ["typescript"]
  }).code;
}
