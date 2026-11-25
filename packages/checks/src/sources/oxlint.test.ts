// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { repoRoot } from "./migrations";
import { pluginFindings, runOxlint } from "./oxlint";

const diagnostic = (code: string) => ({
  code,
  message: "Move it.",
  severity: "warning",
  filename: "a.ts",
  labels: [{ span: { offset: 6, length: 28, line: 1, column: 7 } }]
});

describe("pluginFindings", () => {
  const source = 'await client\n  // why\n  .from("x").update({ a: 1 });';

  it("names the check from the rule and the snippet from the span", () => {
    expect(
      pluginFindings([diagnostic("carbon(route-action-shape)")], () => source)
    ).toEqual([
      {
        checkId: "route-action-shape",
        violation: {
          file: "a.ts",
          line: 1,
          snippet: 'client.from("x")',
          message: "Move it."
        }
      }
    ]);
  });

  it("leaves out the diagnostics of other rules", () => {
    expect(
      pluginFindings([diagnostic("eslint(no-unused-vars)")], () => source)
    ).toEqual([]);
  });
});

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A folder with `config` as its oxlint config and `contents` as an ERP route. */
function routeFolder(config: object, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "carbon-oxlint-plugin-"));
  dirs.push(dir);
  mkdirSync(join(dir, "routes"));
  writeFileSync(join(dir, "routes/route.tsx"), contents);
  writeFileSync(join(dir, ".oxlintrc.json"), JSON.stringify(config));
  return dir;
}

/** Runs one rule of the `carbon` plugin over `contents` as an ERP route. */
function scanWith(rule: string, contents: string): string[] {
  const root = repoRoot();
  const dir = routeFolder(
    {
      plugins: [],
      categories: { correctness: "off" },
      jsPlugins: [join(root, "packages/checks/oxlint-plugins/carbon.mjs")],
      rules: { [`carbon/${rule}`]: "warn" }
    },
    contents
  );
  return pluginFindings(runOxlint(root, ["routes"], dir), () => contents)
    .sort((a, b) => a.violation.line - b.violation.line)
    .map((f) => f.violation.snippet);
}

describe("runOxlint", () => {
  it("fails when the plugin does not load", () => {
    const dir = routeFolder(
      {
        jsPlugins: ["./missing.mjs"],
        rules: { "carbon/route-action-shape": "warn" }
      },
      "export {};"
    );
    expect(() => runOxlint(repoRoot(), ["routes"], dir)).toThrow(
      "oxlint printed no JSON report"
    );
  });
});

describe("route-action-shape", () => {
  const scan = (contents: string) => scanWith("route-action-shape", contents);

  it("flags a client write across lines", () => {
    expect(
      scan(
        `await client\n  .from("job")\n  .update({ status })\n  .eq("id", id);`
      )
    ).toEqual(['client.from("job").update']);
  });

  it("flags a client write with a comment inside the chain", () => {
    expect(
      scan(`await client\n  .from("job")\n  // why\n  .update({ status });`)
    ).toEqual(['client.from("job").update']);
  });

  it("flags Kysely writes and postings", () => {
    expect(
      scan(
        'await db.updateTable("job").set({}).execute();\nawait invokeCreate(ctx, { type: "receiptDefault" });\nawait invokePosting(ctx, "post-receipt", {}, postReceipt);'
      )
    ).toEqual(["db.updateTable", "invokeCreate", "invokePosting"]);
  });

  it("leaves reads and non-database deletes alone", () => {
    expect(
      scan(
        'await client.from("job").select("id");\nformData.delete("intent");\nurl.searchParams.delete("x");'
      )
    ).toEqual([]);
  });

  it("leaves a write named in a comment or a string alone", () => {
    expect(
      scan(
        '// await client.from("job").delete();\nconst text = \'client.from("job").delete()\';'
      )
    ).toEqual([]);
  });

  it("reads the span in bytes after non-ASCII text", () => {
    expect(
      scan('const label = "Größe";\nawait client.from("job").delete();')
    ).toEqual(['client.from("job").delete']);
  });
});
