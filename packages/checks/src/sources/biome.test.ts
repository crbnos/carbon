// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pluginFindings, runBiomePlugins } from "./biome";
import { repoRoot } from "./migrations";

const diagnostic = (message: string) => ({
  category: "plugin",
  message,
  location: {
    path: "a.ts",
    start: { line: 1, column: 7 },
    end: { line: 3, column: 13 }
  }
});

describe("pluginFindings", () => {
  const source = 'await client\n  // why\n  .from("x").update({ a: 1 });';

  it("names the check from the message and the snippet from the span", () => {
    expect(
      pluginFindings(
        [diagnostic("Move it. [route-action-shape]")],
        () => source
      )
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

  it("refuses a plugin message that names no check", () => {
    expect(() =>
      pluginFindings([diagnostic("Move it.")], () => source)
    ).toThrow("must end with its check id");
  });
});

/** Runs one plugin of `biome-plugins/` over `contents` as an ERP route. */
function scanWith(plugin: string, contents: string): string[] {
  const root = repoRoot();
  const dir = mkdtempSync(join(tmpdir(), "carbon-biome-plugin-"));
  dirs.push(dir);
  mkdirSync(join(dir, "routes"));
  writeFileSync(join(dir, "routes/route.tsx"), contents);
  writeFileSync(
    join(dir, "biome.json"),
    JSON.stringify({
      root: true,
      plugins: [join(root, "packages/checks/biome-plugins", `${plugin}.grit`)]
    })
  );
  return pluginFindings(runBiomePlugins(root, ["routes"], dir), () => contents)
    .sort((a, b) => a.violation.line - b.violation.line)
    .map((f) => f.violation.snippet);
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("route-action-shape", () => {
  const scan = (contents: string) => scanWith("routeActionShape", contents);

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
});
