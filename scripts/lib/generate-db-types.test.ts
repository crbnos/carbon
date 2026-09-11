import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { sortRelationships } from "./generate-db-types";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const targets = [
  "packages/database/src/types.ts",
  "packages/database/supabase/functions/lib/types.ts"
] as const;
const original = "export type Database = { public: { Tables: {} } };\n";
const generated =
  "export type Database = { public: { Tables: { example: {} } } };\n";

function runGenerator(
  output: string,
  options: {
    exit?: number;
    databaseUrl?: string;
    missingExecutable?: boolean;
    failSecondReplacement?: boolean;
    envFiles?: Record<string, string>;
  } = {}
) {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "carbon-db-generation-"))
  );
  try {
    for (const [file, content] of Object.entries(options.envFiles ?? {})) {
      writeFileSync(join(directory, file), content);
    }
    for (const target of targets) {
      mkdirSync(dirname(join(directory, target)), { recursive: true });
      writeFileSync(join(directory, target), original);
    }
    mkdirSync(join(directory, "scripts/lib"), { recursive: true });
    copyFileSync(
      join(root, "scripts/generate-db-types.ts"),
      join(directory, "scripts/generate-db-types.ts")
    );
    const helper = "scripts/lib/generate-db-types.ts";
    if (existsSync(join(root, helper)))
      copyFileSync(join(root, helper), join(directory, helper));
    symlinkSync(
      join(root, "node_modules"),
      join(directory, "node_modules"),
      "dir"
    );
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const marker = join(directory, "invoked");
    writeFileSync(join(directory, "output.txt"), output);
    if (!options.missingExecutable) {
      writeFileSync(
        join(bin, "supabase"),
        `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(marker)}, 'yes');\nfs.writeSync(1, fs.readFileSync(${JSON.stringify(join(directory, "output.txt"))}));\nprocess.exit(${options.exit ?? 0});\n`,
        { mode: 0o755 }
      );
    }
    const preload = join(directory, "failure.cjs");
    // Inject an operating-system failure at the second destination only. Real
    // subprocess generation, validation, writes and rollback still execute.
    writeFileSync(
      preload,
      `const fs = require('node:fs');\nlet failed = false;\nconst target = ${JSON.stringify(join(directory, targets[1]))};\nfor (const name of ['renameSync', 'copyFileSync', 'writeFileSync']) {\n  const original = fs[name];\n  fs[name] = (...args) => {\n    const destination = name === 'writeFileSync' ? args[0] : args[1];\n    if (${Boolean(options.failSecondReplacement)} && !failed && require('node:path').resolve(String(destination)) === target) {\n      failed = true;\n      throw Object.assign(new Error('Synthetic second replacement failure'), { code: 'EACCES' });\n    }\n    return original(...args);\n  };\n}\nrequire('node:module').syncBuiltinESMExports();\n`
    );
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        preload,
        "--import",
        require.resolve("tsx"),
        join(directory, "scripts/generate-db-types.ts")
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          NODE_PATH: undefined,
          PATH: bin,
          SUPABASE_DB_URL:
            options.databaseUrl ??
            "postgresql://example:synthetic@127.0.0.1:5432/example"
        }
      }
    );
    return {
      ...result,
      invoked: existsSync(marker),
      contents: targets.map((target) =>
        readFileSync(join(directory, target), "utf8")
      ),
      remaining: targets.map((target) =>
        readdirSync(dirname(join(directory, target)))
      )
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("default .env preserves the caller's database URL without dotenv or NODE_PATH", () => {
  const result = runGenerator(generated, {
    envFiles: {
      ".env": "SUPABASE_DB_URL=postgresql://external.example.com/database\n"
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.invoked, true);
});

test(".env.local overrides the caller's URL before the local-host safety check", () => {
  const result = runGenerator(generated, {
    envFiles: {
      ".env.local":
        "SUPABASE_DB_URL=postgresql://external.example.com/database\n"
    }
  });
  assert.notEqual(result.status, 0);
  assert.equal(result.invoked, false);
  assert.deepEqual(result.contents, [original, original]);
});

test("failed subprocess preserves both last-good outputs and cleans temporary files", () => {
  const result = runGenerator("partial output", { exit: 7 });
  assert.equal(result.invoked, true, result.stderr);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.contents, [original, original]);
  assert.deepEqual(result.remaining, [["types.ts"], ["types.ts"]]);
});

test("missing generator executable preserves both last-good outputs", () => {
  const result = runGenerator(generated, { missingExecutable: true });
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.contents, [original, original]);
  assert.deepEqual(result.remaining, [["types.ts"], ["types.ts"]]);
});

for (const output of [
  "",
  "   \n",
  "export type Database = {",
  "export const unrelated = 42;",
  "type Database = {};"
]) {
  test(`rejects unusable successful output (${JSON.stringify(output)})`, () => {
    const result = runGenerator(output);
    assert.equal(result.invoked, true, result.stderr);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.contents, [original, original]);
    assert.deepEqual(result.remaining, [["types.ts"], ["types.ts"]]);
  });
}

test("failure replacing the second output rolls back the first output", () => {
  const result = runGenerator(generated, { failSecondReplacement: true });
  assert.equal(result.invoked, true, result.stderr);
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.contents, [original, original]);
  assert.deepEqual(result.remaining, [["types.ts"], ["types.ts"]]);
});

for (const databaseUrl of [
  "postgresql://localhost:synthetic-secret@example.com/example",
  "postgresql://example:synthetic-secret@127.0.0.1.example.com/example",
  "postgresql://example:synthetic-secret@example.com/localhost",
  "http://example:synthetic-secret@localhost/example",
  "postgresql://example:synthetic-secret@localhost/example?host=example.com",
  "postgresql://example:synthetic-secret@localhost/example?hostaddr=192.0.2.1",
  "not-a-database-url"
]) {
  test(`rejects a malformed or non-local database URL (${databaseUrl.split(":")[0]})`, () => {
    const result = runGenerator(generated, { databaseUrl });
    assert.notEqual(result.status, 0);
    assert.equal(result.invoked, false);
    assert.deepEqual(result.contents, [original, original]);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /synthetic-secret|example\.com/
    );
  });
}

for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
  test(`publishes identical validated outputs for local host ${host}`, () => {
    const result = runGenerator(generated, {
      databaseUrl: `postgresql://example:synthetic@${host}:5432/example`
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.contents, [generated, generated]);
    assert.deepEqual(result.remaining, [["types.ts"], ["types.ts"]]);
  });
}

test("MCP generation does not cache incomplete transitive input coverage", () => {
  const turbo = JSON.parse(readFileSync(join(root, "turbo.json"), "utf8"));
  assert.equal(turbo.tasks["//#generate:mcp"].cache, false);
});

test("sortRelationships orders each Relationships block deterministically", () => {
  const block = (entries: string[]) =>
    ["      x: {", "        Relationships: [", ...entries, "        ]", "      }"].join("\n");
  const entry = (fk: string, col: string, last = false) =>
    [
      "          {",
      `            foreignKeyName: "${fk}"`,
      `            columns: ["${col}"]`,
      "            isOneToOne: false",
      '            referencedRelation: "country"',
      '            referencedColumns: ["code"]',
      last ? "          }" : "          },"
    ].join("\n");
  const a = block([entry("x_fkey", "supplierCountryCode"), entry("x_fkey", "customerCountryCode", true)]);
  const b = block([entry("x_fkey", "customerCountryCode"), entry("x_fkey", "supplierCountryCode", true)]);
  assert.equal(sortRelationships(a), sortRelationships(b));
  assert.equal(sortRelationships(a), b, "sorted output keeps a trailing comma on every entry but the last");
  assert.equal(sortRelationships("        Relationships: []\n      }"), "        Relationships: []\n      }");
});
