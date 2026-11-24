// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const packageDir = join(here, "..");
export const repoRoot = join(packageDir, "..", "..");
const coverageFile = join(packageDir, "coverage.json");

export function readCoverage() {
  return JSON.parse(readFileSync(coverageFile, "utf8"));
}

export function writeCoverage(coverage) {
  writeFileSync(coverageFile, `${JSON.stringify(coverage, null, 2)}\n`);
}

/**
 * The source an entry covers: a top-level function or const, from its
 * declaration to the closing brace at column 0, or, for an entry that is not
 * an identifier, every line holding it (a statement inside a function too
 * large to cover whole). Null when it is gone. The closing brace stands alone
 * on its line: `}): Promise<…> {` ends a multi-line parameter list, not the
 * body.
 */
function covered(source, entry) {
  const lines = source.split("\n");
  if (!/^\w+$/.test(entry)) {
    const hits = lines.filter((line) => line.includes(entry));
    return hits.length > 0 ? hits.join("\n") : null;
  }
  const declaration = new RegExp(
    `^(export )?(async )?(function\\s+${entry}\\b|const ${entry}\\b)`
  );
  const start = lines.findIndex((line) => declaration.test(line));
  if (start < 0) return null;
  const end = lines.findIndex((line, i) => i > start && /^};?\s*$/.test(line));
  return lines.slice(start, end < 0 ? undefined : end + 1).join("\n");
}

/** A hash of each covered entry, keyed `file#entry`, as the code reads now. */
export function fingerprints(model) {
  const out = {};
  for (const [file, entries] of Object.entries(model.code)) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    for (const entry of entries) {
      const text = covered(source, entry);
      out[`${file}#${entry}`] =
        text === null
          ? "missing"
          : createHash("sha256").update(text).digest("hex").slice(0, 16);
    }
  }
  return out;
}
