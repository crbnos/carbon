import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { readLocalScriptConfig } from "./local-script-config";

test("readLocalScriptConfig returns the requested values from the environment", () => {
  const config = readLocalScriptConfig(["A_KEY", "B_KEY"], {
    A_KEY: "a",
    B_KEY: "b",
    C_KEY: "ignored"
  });
  assert.deepEqual(config, { A_KEY: "a", B_KEY: "b" });
});

test("readLocalScriptConfig names missing keys without disclosing configured values", () => {
  assert.throws(
    () =>
      readLocalScriptConfig(["A_KEY", "B_KEY", "C_KEY"], {
        A_KEY: "private-value-sentinel",
        B_KEY: "   "
      }),
    (error: Error) => {
      assert.match(error.message, /B_KEY/);
      assert.match(error.message, /C_KEY/);
      assert.doesNotMatch(error.message, /private-value-sentinel/);
      return true;
    }
  );
});

for (const script of ["sandbox", "model-upload", "sales-invoice-report"]) {
  test(`${script} CLI reaches its configuration error with NODE_PATH unset`, () => {
    const directory = mkdtempSync(join(tmpdir(), "carbon-script-config-"));
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          createRequire(import.meta.url).resolve("tsx"),
          resolve(`scripts/${script}.ts`)
        ],
        { cwd: directory, env: {}, encoding: "utf8", timeout: 15_000 }
      );
      assert(result.status === 1, "Missing configuration must fail the CLI");
      assert(
        result.stderr.includes("Missing required local configuration"),
        "CLI must reach the configuration guard before any dependency or IO error"
      );
      assert(!result.stderr.includes("ERR_MODULE_NOT_FOUND"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("real .env parser and pinned SDK load without root dependency aliases or network", () => {
  const directory = mkdtempSync(join(tmpdir(), "carbon-script-client-"));
  try {
    writeFileSync(
      join(directory, ".env"),
      'SUPABASE_URL="https://database.example.com"\nCARBON_API_KEY="fixture-api-key"\n'
    );
    writeFileSync(
      join(directory, ".env.local"),
      'CARBON_API_KEY="fixture-local-override"\n'
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        createRequire(import.meta.url).resolve("tsx"),
        "--input-type=module",
        "--eval",
        `import assert from "node:assert/strict";
import helpers from ${JSON.stringify(
          pathToFileURL(resolve("scripts/lib/local-script-config.ts")).href
        )};
const { createScriptClient, readLocalScriptConfig } = helpers;
const config = readLocalScriptConfig(
  ["SUPABASE_URL", "SUPABASE_ANON_KEY", "CARBON_API_KEY"],
  { SUPABASE_ANON_KEY: "fixture-public-key", CARBON_API_KEY: "fixture-environment" }
);
let calls = 0;
globalThis.fetch = async (input, init) => {
  calls += 1;
  assert(String(input).startsWith("https://database.example.com/rest/v1/fixture"));
  assert(new Headers(init.headers).get("carbon-key") === "fixture-local-override");
  return new Response('[{"id":"fixture"}]', {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};
const client = createScriptClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, config.CARBON_API_KEY);
const result = await client.from("fixture").select("*");
assert.equal(result.error, null);
assert.equal(result.data[0].id, "fixture");
assert.equal(calls, 1);`
      ],
      { cwd: directory, env: {}, encoding: "utf8", timeout: 15_000 }
    );
    assert(
      result.status === 0,
      "Real environment parsing, pinned SDK resolution, and stubbed request must succeed"
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
