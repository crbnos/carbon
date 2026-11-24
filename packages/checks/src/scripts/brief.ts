// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// `pnpm brief <file> [<file> …]`: the checks, rules and lessons that apply to
// each file, before an agent edits it. Information, not a gate: exits 0.

import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { loadBaseline } from "../baseline";
import { brief, formatBriefing, isEmpty } from "../brief/brief";
import { buildBriefIndex } from "../brief/index-builder";
import { repoRoot } from "../sources/migrations";

const root = repoRoot();
const cwd = process.env.INIT_CWD ?? process.cwd();
const files = process.argv.slice(2);

if (files.length === 0) {
  process.stdout.write("Usage: pnpm brief <file> [<file> …]\n");
  process.exit(0);
}

const index = buildBriefIndex(root);
const baseline = loadBaseline();

for (const arg of files) {
  const path = relative(root, resolve(cwd, arg));
  const absolute = resolve(root, path);
  const content = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  const result = brief({
    root,
    path,
    before: content,
    after: content,
    index,
    baseline
  });
  const body = isEmpty(result) ? "Nothing in scope." : formatBriefing(result);
  process.stdout.write(`## ${path}\n\n${body}\n\n`);
}
