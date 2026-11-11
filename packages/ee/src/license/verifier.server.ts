// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { brotliDecompressSync } from "node:zlib";
import type { VerifyInput, VerifyOutput } from "./types";

declare global {
  var Go:
    | (new () => {
        importObject: WebAssembly.Imports;
        run(instance: WebAssembly.Instance): Promise<void>;
      })
    | undefined;
  var crbnClp: { verify(input: string): string } | undefined;
}

let loaded: Promise<void> | null = null;

/**
 * Starts the verifier once per process: about 12 ms to decompress. The ERP
 * server calls it at boot on Enterprise only, so Cloud and Community never
 * load the 1.4 MB module or the globals wasm_exec.js sets (fs, path). A
 * failed load is retried on the next call.
 */
export function loadVerifier(): Promise<void> {
  loaded ??= (async () => {
    // Defines globalThis.Go, Go's loader for its WebAssembly builds.
    await import("./verifier/wasm_exec.js");
    const { default: wasmBase64 } = await import(
      "./verifier/clp-wasm.generated"
    );
    if (typeof globalThis.Go !== "function") {
      throw new Error("licence: wasm_exec.js did not define globalThis.Go");
    }
    const buf = brotliDecompressSync(Buffer.from(wasmBase64, "base64"));
    const go = new globalThis.Go();
    const { instance } = await WebAssembly.instantiate(
      new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      go.importObject
    );
    // Resolves only when the Go program exits, which it never does.
    void go.run(instance);
    if (!globalThis.crbnClp) {
      throw new Error("licence: the verifier did not register crbnClp");
    }
  })().catch((error) => {
    loaded = null;
    throw error;
  });
  return loaded;
}

export async function verify(input: VerifyInput): Promise<VerifyOutput> {
  await loadVerifier();
  return JSON.parse(globalThis.crbnClp!.verify(JSON.stringify(input)));
}
