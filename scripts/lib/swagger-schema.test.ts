import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeSwaggerSchema } from "./swagger-schema";

const pk = "This is a Primary Key.<pk/>";
const fk =
  "This is a Foreign Key to `supplierLocation.id`.<fk table='supplierLocation' column='id'/>";
const fixture = (chosen: "id" | "supplierLocationId") => ({
  swagger: "2.0",
  definitions: {
    partners: {
      properties: {
        id: {
          type: "string",
          format: "text",
          description: `Original id documentation.\n\nNote:\n${chosen === "id" ? `${pk}\n` : ""}${fk}`
        },
        supplierLocationId: {
          type: "string",
          format: "text",
          description: `Alias documentation.\n\nNote:\n${chosen === "supplierLocationId" ? `${pk}\n` : ""}${fk}`
        }
      }
    },
    unrelated: { properties: { id: { description: `Leave untouched: ${pk}` } } }
  },
  paths: { "/partners": { get: { description: "Public API contract" } } }
});

test("both observed alias choices normalize to identical metadata", () => {
  assert.deepEqual(
    normalizeSwaggerSchema(fixture("supplierLocationId")),
    fixture("id")
  );
  assert.deepEqual(normalizeSwaggerSchema(fixture("id")), fixture("id"));
});

test("normalization is idempotent and leaves the input object intact", () => {
  const input = fixture("supplierLocationId");
  const saved = structuredClone(input);
  const first = normalizeSwaggerSchema(input);
  assert.deepEqual(first, normalizeSwaggerSchema(first));
  assert.deepEqual(input, saved);
});

async function runCli(options: { failStatus?: number; repeat?: boolean } = {}) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), "carbon-swagger-generation-"));
  const output = join(directory, "packages/database/src/swagger-docs-schema.ts");
  const previous = "export default { previous: true };\n";
  let generations = 0;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (options.failStatus) {
      response.statusCode = options.failStatus;
      response.end(JSON.stringify({ error: "synthetic-private-diagnostic" }));
      return;
    }
    response.end(
      JSON.stringify(
        fixture(generations++ % 2 === 0 ? "supplierLocationId" : "id")
      )
    );
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, previous);
    mkdirSync(join(directory, "scripts/lib"), { recursive: true });
    for (const path of [
      "scripts/generate-swagger-docs.ts",
      "scripts/lib/swagger-schema.ts",
      "scripts/lib/local-script-config.ts"
    ])
      copyFileSync(join(root, path), join(directory, path));
    const results = [];
    for (let iteration = 0; iteration < (options.repeat ? 2 : 1); iteration++) {
      const child = spawn(
        process.execPath,
        [
          "--import",
          join(root, "node_modules/tsx/dist/loader.mjs"),
          join(directory, "scripts/generate-swagger-docs.ts")
        ],
        {
          cwd: directory,
          env: {
            PATH: process.env.PATH,
            PORT_STUDIO: String(address.port),
            NODE_PATH: undefined
          },
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      results.push({ code, stderr, output: readFileSync(output, "utf8") });
    }
    return { results, previous, remaining: readdirSync(dirname(output)) };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("real CLI produces identical files for both observed alias variants", async () => {
  const result = await runCli({ repeat: true });
  for (const run of result.results) assert.equal(run.code, 0, run.stderr);
  assert.equal(result.results[0]!.output, result.results[1]!.output);
  assert.deepEqual(result.remaining, ["swagger-docs-schema.ts"]);
});

test("real CLI preserves last-good output when the request fails", async () => {
  const result = await runCli({ failStatus: 500 });
  assert.notEqual(result.results[0]!.code, 0);
  assert.equal(result.results[0]!.output, result.previous);
  assert.deepEqual(result.remaining, ["swagger-docs-schema.ts"]);
  assert.doesNotMatch(result.results[0]!.stderr, /synthetic/);
});
