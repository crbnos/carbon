// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Violation } from "../check";
import { blankComments } from "./comments";

// A rule that reads TypeScript syntax is a rule of the `carbon` oxlint plugin
// (`oxlint-plugins/carbon.mjs`, enabled in the root `oxlint.config.ts`), so the
// editor shows it and oxlint's parser does the matching. oxlint has no
// baseline, so the rules warn and this file turns them into findings the
// conformance baseline can grandfather.

const PLUGIN = "carbon";

type Span = { offset: number; length: number; line: number; column: number };

export type OxlintDiagnostic = {
  /** `plugin(rule)`, e.g. `carbon(route-action-shape)`. Missing when oxlint itself failed. */
  code?: string;
  message: string;
  severity: string;
  filename: string;
  labels: { span: Span }[];
};

/**
 * Every diagnostic oxlint reports under `paths`, which are relative to `cwd`:
 * the folder whose oxlint config enables the plugin (the repo root). Throws
 * when oxlint does not run, cannot load its config or the plugin, or a plugin
 * rule crashes: an empty result must mean a clean tree.
 */
export function runOxlint(
  root: string,
  paths: string[],
  cwd: string = root
): OxlintDiagnostic[] {
  const run = spawnSync(
    join(root, "node_modules/.bin/oxlint"),
    ["--format=json", ...paths],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  if (run.error) throw run.error;
  let report: { diagnostics: OxlintDiagnostic[] };
  try {
    report = JSON.parse(run.stdout);
  } catch {
    // A config or plugin that does not load prints its error as text.
    throw new Error(
      `oxlint printed no JSON report:\n${run.stdout}${run.stderr}`
    );
  }
  const failure = report.diagnostics.find((d) => !d.code);
  if (failure) {
    throw new Error(
      `oxlint failed on ${failure.filename}:\n${failure.message}`
    );
  }
  return report.diagnostics;
}

/** The text a span covers. oxlint's offsets count UTF-8 bytes. */
function spanText(contents: string, { offset, length }: Span): string {
  return Buffer.from(contents, "utf8")
    .subarray(offset, offset + length)
    .toString("utf8");
}

/**
 * Pure: the plugin's diagnostics as findings, named by rule, with the matched
 * source as the snippet. Diagnostics of other rules are left out.
 */
export function pluginFindings(
  diagnostics: OxlintDiagnostic[],
  read: (path: string) => string
): { checkId: string; violation: Violation }[] {
  const prefix = `${PLUGIN}(`;
  return diagnostics
    .filter((d) => d.code?.startsWith(prefix))
    .map(({ code = "", message, filename, labels }) => {
      const span = labels[0]?.span;
      if (!span) throw new Error(`${code} reported nothing to point at`);
      return {
        checkId: code.slice(prefix.length, -1),
        violation: {
          file: filename,
          line: span.line,
          snippet: blankComments(spanText(read(filename), span)).replace(
            /\s+/g,
            ""
          ),
          message
        }
      };
    });
}

/** The plugin findings for `paths`, read from the working tree. */
export function loadPluginFindings(root: string, paths: string[]) {
  return pluginFindings(runOxlint(root, paths), (path) =>
    readFileSync(join(root, path), "utf8")
  );
}
