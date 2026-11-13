// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// Copies a WebAssembly licence verifier build (clp.wasm.br, wasm_exec.js)
// into src/license/verifier.
//
//   pnpm --filter @carbon/ee sync:licence-verifier <build directory>

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const build = process.argv[2];
if (!build) {
  console.error("usage: sync-licence-verifier <build directory>");
  process.exit(1);
}

const dir = resolve(build);
const out = join(dirname(fileURLToPath(import.meta.url)), "../src/license/verifier");
const wasm = readFileSync(join(dir, "clp.wasm.br")).toString("base64");

writeFileSync(
  join(out, "clp-wasm.generated.ts"),
  `// GENERATED FILE — do not edit.\nexport default "${wasm}";\n`
);
copyFileSync(join(dir, "wasm_exec.js"), join(out, "wasm_exec.js"));
console.log("licence verifier synced");
