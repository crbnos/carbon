import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const settings = {
  SUPABASE_URL: "https://database.example.com",
  SUPABASE_ANON_KEY: "fixture-public-key",
  CARBON_API_KEY: "fixture-api-key",
  CARBON_COMPANY_ID: "fixture-company",
  MODEL_UPLOAD_URL: "https://erp.example.com/api/model/upload",
  MODEL_FILE_PATH: "/fixture/model.stl",
  SALES_INVOICE_REPORT_PATH: "/fixture/report.json"
};

function compile(filename: string) {
  const source = readFileSync(filename, "utf8").replaceAll(
    "import.meta.url",
    JSON.stringify(pathToFileURL(resolve(filename)).href)
  );
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  }).outputText;
}

function execute(script: string, env: Record<string, string>) {
  const clients: unknown[][] = [];
  const requests: unknown[][] = [];
  const reads: unknown[] = [];
  const writes: unknown[][] = [];
  const filters: unknown[][] = [];
  const uploads: unknown[][] = [];
  const chain = {
    select: () => chain,
    limit: () => chain,
    order: () => chain,
    eq: (...args: unknown[]) => {
      filters.push(args);
      return chain;
    },
    then: (resolve: (value: unknown) => void) =>
      resolve({ data: [{ id: "fixture-result" }], error: null })
  };
  const bindings = {
    exports: {},
    process: {
      env,
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      exit: () => assert.fail("Unexpected process exit")
    },
    console: { log: () => undefined, error: () => undefined },
    FormData,
    fetch: async (...args: unknown[]) => {
      requests.push(args);
      return new Response(JSON.stringify({ uploaded: true }));
    },
    require: (name: string) => {
      if (name === "node:module") {
        return { createRequire: () => bindings.require };
      }
      if (name === "node:util") return { parseEnv: () => ({}) };
      if (name === "./lib/local-script-config") {
        const exports = {};
        runInNewContext(compile("scripts/lib/local-script-config.ts"), {
          exports,
          require: bindings.require,
          URL
        });
        return exports;
      }
      if (name === "@supabase/supabase-js") {
        return {
          createClient: (...args: unknown[]) => {
            clients.push(args);
            return {
              from: () => chain,
              storage: {
                from: () => ({
                  upload: async (...args: unknown[]) => {
                    uploads.push(args);
                    return { error: null };
                  }
                })
              }
            };
          }
        };
      }
      if (name === "fs" || name === "node:fs") {
        return {
          existsSync: () => false,
          readFileSync: (path: string) => {
            reads.push(path);
            return Buffer.from("fixture");
          },
          statSync: () => ({ size: 7 }),
          writeFileSync: (...args: unknown[]) => writes.push(args)
        };
      }
      if (name === "crypto" || name === "node:crypto") {
        return { randomUUID: () => "fixture-model" };
      }
      if (name === "os" || name === "node:os") {
        return { homedir: () => "/fixture/home" };
      }
      if (name === "path" || name === "node:path") {
        return {
          basename: () => "model.stl",
          extname: () => ".stl",
          join: (...parts: string[]) => parts.join("/")
        };
      }
      throw new Error(`Unexpected script dependency: ${name}`);
    }
  };
  return {
    run: Promise.resolve().then(() =>
      runInNewContext(compile(`scripts/${script}.ts`), bindings)
    ),
    clients,
    requests,
    reads,
    writes,
    filters,
    uploads
  };
}

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

  test(`${script} rejects missing local configuration before any client or IO`, async () => {
    const result = execute(script, {});
    await assert.rejects(result.run, /Missing required local configuration/);
    assert.equal(result.clients.length, 0);
    assert.equal(result.requests.length, 0);
    assert.equal(result.reads.length, 0);
    assert.equal(result.writes.length, 0);
  });

  test(`${script} rejects blank keys without disclosing other configured values`, async () => {
    const result = execute(script, {
      ...settings,
      SUPABASE_ANON_KEY: "private-value-sentinel",
      CARBON_API_KEY: "   "
    });
    await assert.rejects(result.run, (error: unknown) => {
      assert(error instanceof Error || typeof error === "object");
      const message = String((error as Error).message);
      assert.match(message, /CARBON_API_KEY/);
      assert.doesNotMatch(message, /private-value-sentinel/);
      return true;
    });
    assert.equal(result.clients.length, 0);
  });
}

test("sandbox passes explicitly configured identity to its real client call", async () => {
  const result = execute("sandbox", settings);
  await result.run;
  assert.equal(result.clients.length, 1);
  const [url, publicKey, options] = result.clients[0]!;
  assert(url === settings.SUPABASE_URL, "Configured database URL must be used");
  assert(
    publicKey === settings.SUPABASE_ANON_KEY,
    "Configured public key must be used"
  );
  assert(
    (options as { global: { headers: Record<string, string> } }).global.headers[
      "carbon-key"
    ] === settings.CARBON_API_KEY,
    "Configured API key must be used"
  );
});

test("model upload uses explicit file, company, and API endpoint configuration", async () => {
  const result = execute("model-upload", settings);
  await result.run;
  assert(
    result.reads[0] === settings.MODEL_FILE_PATH,
    "Configured file must be read"
  );
  assert(
    result.uploads[0]?.[0] === "fixture-company/models/fixture-model.stl",
    "Storage upload must retain configured company scoping"
  );
  assert(
    result.requests[0]?.[0] === settings.MODEL_UPLOAD_URL,
    "Metadata must be posted to the configured endpoint"
  );
});

test("sales report uses configured company scope and explicit local output path", async () => {
  const result = execute("sales-invoice-report", settings);
  await result.run;
  assert(
    result.filters[0]?.[0] === "companyId" &&
      result.filters[0]?.[1] === settings.CARBON_COMPANY_ID,
    "Report query must retain configured company scoping"
  );
  assert(
    result.writes[0]?.[0] === settings.SALES_INVOICE_REPORT_PATH,
    "Report must be written to the explicitly configured path"
  );
});

test("real .env parser and pinned SDK load without root dependency aliases or network", () => {
  const directory = mkdtempSync(join(tmpdir(), "carbon-script-client-"));
  try {
    writeFileSync(
      join(directory, ".env"),
      'SUPABASE_URL="https://database.example.com"\nCARBON_API_KEY="fixture-api-key"\n'
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
  { SUPABASE_ANON_KEY: "fixture-public-key", CARBON_API_KEY: "fixture-override" }
);
let calls = 0;
globalThis.fetch = async (input, init) => {
  calls += 1;
  assert(String(input).startsWith("https://database.example.com/rest/v1/fixture"));
  assert(new Headers(init.headers).get("carbon-key") === "fixture-override");
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
