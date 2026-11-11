// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { SourceFile } from "../check";
import {
  findIntegrationsWithoutRule,
  type IntegrationDir,
  ruleGlobs
} from "./integration-has-rule";

const dir = (
  name: string,
  config: string,
  extraFiles: string[] = []
): IntegrationDir => ({
  name,
  configs: [{ file: `packages/ee/src/${name}/config.tsx`, contents: config }],
  files: [
    `packages/ee/src/${name}/config.tsx`,
    `packages/ee/src/${name}/lib/client.ts`,
    ...extraFiles.map((f) => `packages/ee/src/${name}/${f}`)
  ].sort()
});

const define = (exportName: string, active: string) => `
import { defineIntegration } from "../fns";

export const ${exportName} = defineIntegration({
  name: "${exportName}",
  id: "${exportName.toLowerCase()}",
  active: ${active},
  settings: [{ name: "x", active: false }]
});`;

const registry = (...names: string[]): SourceFile => ({
  file: "packages/ee/src/index.ts",
  contents: `export const integrations = [\n${names.map((n) => `  ${n},`).join("\n")}\n];`
});

const rule = (file: string, frontmatter: string): SourceFile => ({
  file: `.claude/rules/${file}`,
  contents: `---\n${frontmatter}\n---\n\n# Rule\n`
});

const uncovered = (
  integrations: IntegrationDir[],
  rules: SourceFile[] = [],
  reg: SourceFile = registry("Acme", "Beta")
) =>
  findIntegrationsWithoutRule({ integrations, registry: reg, rules }).map(
    (v) => v.snippet
  );

describe("findIntegrationsWithoutRule", () => {
  it("passes a directory a rule's paths: glob covers", () => {
    expect(
      uncovered(
        [dir("acme", define("Acme", "true"))],
        [rule("acme-integration.md", "paths:\n  - packages/ee/src/acme/**")]
      )
    ).toEqual([]);
  });

  it("fails an active directory no rule covers, with the fix in the message", () => {
    const found = findIntegrationsWithoutRule({
      integrations: [dir("acme", define("Acme", "!!ACME_CLIENT_ID"))],
      registry: registry("Acme"),
      rules: [
        rule("jira-integration.md", "paths:\n  - packages/ee/src/jira/**")
      ]
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      file: "packages/ee/src/acme/config.tsx",
      line: 4,
      snippet: "packages/ee/src/acme"
    });
    expect(found[0]?.message).toBe(
      "`packages/ee/src/acme` is a registered integration with no rule. Add `.claude/rules/acme-integration.md` with a `paths:` glob for it, or a `packages/ee/src/acme/AGENTS.md`."
    );
  });

  it("passes a directory whose every definition has a literal active: false", () => {
    expect(uncovered([dir("acme", define("Acme", "false"))])).toEqual([]);
  });

  it("fails when one of two definitions in the directory is active", () => {
    const acme = dir("acme", define("Acme", "false"));
    acme.configs.push({
      file: "packages/ee/src/acme/config-v2.tsx",
      contents: define("Beta", "ACME_V2 === true")
    });
    expect(uncovered([acme])).toEqual(["packages/ee/src/acme"]);
  });

  it("passes a directory with its own AGENTS.md", () => {
    expect(
      uncovered([dir("acme", define("Acme", "true"), ["AGENTS.md"])])
    ).toEqual([]);
  });

  it("does not count an AGENTS.md nested deeper in the directory", () => {
    expect(
      uncovered([dir("acme", define("Acme", "true"), ["lib/AGENTS.md"])])
    ).toEqual(["packages/ee/src/acme"]);
  });

  it("matches a quoted glob in a block list and in an inline array", () => {
    expect(
      uncovered(
        [
          dir("acme", define("Acme", "true")),
          dir("beta", define("Beta", "true"))
        ],
        [
          rule("a.md", 'paths:\n  - "packages/ee/src/acme/**"'),
          rule("b.md", "paths: ['apps/**', 'packages/ee/src/beta/']")
        ]
      )
    ).toEqual([]);
  });

  it("counts a glob that names one file in the directory", () => {
    expect(
      uncovered(
        [dir("acme", define("Acme", "true"))],
        [rule("a.md", "paths:\n  - packages/ee/src/acme/lib/*.ts")]
      )
    ).toEqual([]);
  });

  it("does not count a glob that names no file in the directory", () => {
    expect(
      uncovered(
        [dir("acme", define("Acme", "true"))],
        [rule("a.md", "paths:\n  - packages/ee/src/acme/missing.ts")]
      )
    ).toEqual(["packages/ee/src/acme"]);
  });

  it("does not count a wildcard that reaches the directory without naming it", () => {
    expect(
      uncovered(
        [dir("acme", define("Acme", "true"))],
        [rule("a.md", 'paths: ["apps/**", "packages/**"]')]
      )
    ).toEqual(["packages/ee/src/acme"]);
  });

  it("does not let a sibling directory's prefix cover it", () => {
    expect(
      uncovered(
        [dir("acme", define("Acme", "true"))],
        [rule("a.md", "paths:\n  - packages/ee/src/acme-extra/**")]
      )
    ).toEqual(["packages/ee/src/acme"]);
  });

  it("checks a definePieceIntegration descriptor", () => {
    const piece = `export const Acme = definePieceIntegration("acme", {
  name: "Acme",
  active: CONTROLLED_ENVIRONMENT === false
});`;
    expect(uncovered([dir("acme", piece)])).toEqual(["packages/ee/src/acme"]);
  });

  it("skips a definition the registry does not list, or lists only in a comment", () => {
    expect(
      uncovered([dir("acme", define("Acme", "true"))], [], {
        file: "packages/ee/src/index.ts",
        contents: "export const integrations = [\n  // Acme,\n  Beta\n];"
      })
    ).toEqual([]);
  });

  it("treats every definition as registered when the registry array is missing", () => {
    expect(
      uncovered([dir("acme", define("Acme", "true"))], [], {
        file: "packages/ee/src/index.ts",
        contents: "export {};"
      })
    ).toEqual(["packages/ee/src/acme"]);
  });

  it("skips a directory whose config defines no integration", () => {
    expect(uncovered([dir("acme", "export const x = 1;")])).toEqual([]);
  });
});

describe("ruleGlobs", () => {
  it("reads a block list, an inline array and a scalar; ignores no frontmatter", () => {
    expect(
      ruleGlobs(
        '---\npaths:\n  - a/**\n  - "b/c.ts" \n  - d/** # note\ndescription: x\n---\n'
      )
    ).toEqual(["a/**", "b/c.ts", "d/**"]);
    expect(ruleGlobs("---\npaths: [\"a/**\", 'b/**']\n---\n")).toEqual([
      "a/**",
      "b/**"
    ]);
    expect(ruleGlobs("---\npaths: a/**\n---\n")).toEqual(["a/**"]);
    expect(ruleGlobs("# Title\n\npaths:\n  - a/**\n")).toEqual([]);
  });
});
