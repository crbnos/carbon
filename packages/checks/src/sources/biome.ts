// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Violation } from "../check";
import { blankComments } from "./comments";

// A rule that reads TypeScript syntax is a Biome plugin (`biome-plugins/*.grit`,
// enabled in the root `biome.jsonc`), so the editor shows it and Biome's parser
// does the matching. Biome has no baseline, so the plugins report warnings and
// this file turns them into findings the conformance baseline can grandfather.

type Position = { line: number; column: number };

export type BiomeDiagnostic = {
  category: string;
  message: string;
  location: { path: string; start: Position; end: Position };
};

/**
 * Every plugin diagnostic Biome reports under `paths`, which are relative to
 * `cwd`: the folder whose Biome config enables the plugins (the repo root).
 */
export function runBiomePlugins(
  root: string,
  paths: string[],
  cwd: string = root
): BiomeDiagnostic[] {
  const run = spawnSync(
    join(root, "node_modules/.bin/biome"),
    [
      "lint",
      "--only=plugin",
      "--reporter=json",
      "--max-diagnostics=none",
      ...paths
    ],
    { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  if (run.error) throw run.error;
  let report: { diagnostics: BiomeDiagnostic[] };
  try {
    report = JSON.parse(run.stdout);
  } catch {
    throw new Error(`biome lint printed no JSON report:\n${run.stderr}`);
  }
  return report.diagnostics.filter((d) => d.category === "plugin");
}

/** The source text a diagnostic points at. Biome's lines and columns start at 1. */
function spanText(contents: string, start: Position, end: Position): string {
  const lines = contents.split("\n").slice(start.line - 1, end.line);
  lines[lines.length - 1] = lines[lines.length - 1]!.slice(0, end.column - 1);
  lines[0] = lines[0]!.slice(start.column - 1);
  return lines.join("\n");
}

/**
 * A plugin's message ends with its check id in brackets (`… [route-action-shape]`):
 * Biome 2.5 reports every plugin under the one category `plugin`, so the id
 * has to travel in the message.
 */
function checkIdOf(message: string): string {
  const open = message.lastIndexOf("[");
  if (open === -1 || !message.endsWith("]")) {
    throw new Error(
      `A Biome plugin message must end with its check id in brackets: ${message}`
    );
  }
  return message.slice(open + 1, -1);
}

/** Pure: the diagnostics as findings, with the matched source as the snippet. */
export function pluginFindings(
  diagnostics: BiomeDiagnostic[],
  read: (path: string) => string
): { checkId: string; violation: Violation }[] {
  return diagnostics.map(({ message, location }) => ({
    checkId: checkIdOf(message),
    violation: {
      file: location.path,
      line: location.start.line,
      snippet: blankComments(
        spanText(read(location.path), location.start, location.end)
      ).replace(/\s+/g, ""),
      message: message.slice(0, message.lastIndexOf("[")).trimEnd()
    }
  }));
}

/** The plugin findings for `paths`, read from the working tree. */
export function loadPluginFindings(root: string, paths: string[]) {
  return pluginFindings(runBiomePlugins(root, paths), (path) =>
    readFileSync(join(root, path), "utf8")
  );
}
