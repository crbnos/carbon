// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// One-off: split .ai/lessons.md into one file per lesson under .ai/lessons/,
// so `pnpm brief` can select each lesson by its own scope.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../sources/migrations";

export function slugOf(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function splitLessons(
  markdown: string
): { slug: string; title: string; body: string }[] {
  const out: { slug: string; title: string; body: string }[] = [];
  const used = new Map<string, number>();
  const sections = markdown.split(/^## /m).slice(1);
  for (const section of sections) {
    const newline = section.indexOf("\n");
    const title = (newline === -1 ? section : section.slice(0, newline)).trim();
    const body = (newline === -1 ? "" : section.slice(newline + 1))
      .replace(/\n---\s*$/, "")
      .trim();
    const base = slugOf(title) || "lesson";
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    out.push({ slug: count === 1 ? base : `${base}-${count}`, title, body });
  }
  return out;
}

function main() {
  const root = repoRoot();
  const source = readFileSync(join(root, ".ai/lessons.md"), "utf8");
  const dir = join(root, ".ai/lessons");
  mkdirSync(dir, { recursive: true });
  const lessons = splitLessons(source);
  for (const { slug, title, body } of lessons) {
    writeFileSync(
      join(dir, `${slug}.md`),
      `---\npaths: []\ntriggers: []\npromoted: null\n---\n# ${title}\n\n${body}\n`
    );
  }
  process.stdout.write(`Wrote ${lessons.length} lessons to .ai/lessons/\n`);
}

if (process.argv[1]?.endsWith("split-lessons.ts")) main();
