// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { matchesGlob } from "node:path";
import { parse } from "yaml";

/**
 * Code text that shows an entry's topic. A string selects the entry when it
 * occurs once; the object form only when `text` occurs `minCount` times or
 * more (two `.update(` calls in one file mean "needs a transaction").
 */
export type Trigger = string | { text: string; minCount: number };

/** Where a rule, a check or a lesson applies: file globs and code text. */
export type Scope = { paths: string[]; triggers: Trigger[] };

export function matchesPath(path: string, globs: string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

/** Non-overlapping, case-sensitive occurrences: triggers are code tokens. */
export function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = text.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = text.indexOf(needle, at + needle.length);
  }
  return count;
}

export function triggerText(trigger: Trigger): string {
  return typeof trigger === "string" ? trigger : trigger.text;
}

export function matchingTriggers(text: string, triggers: Trigger[]): Trigger[] {
  return triggers.filter((trigger) =>
    typeof trigger === "string"
      ? text.includes(trigger)
      : countOccurrences(text, trigger.text) >= trigger.minCount
  );
}

/**
 * Splits a markdown file into its YAML frontmatter and its body. A YAML error
 * throws: Claude Code loads a rule whose frontmatter does not parse in every
 * session, so a broken block must fail loudly here.
 */
export function parseFrontmatter(markdown: string): {
  data: Record<string, unknown>;
  body: string;
} {
  if (!markdown.startsWith("---\n")) return { data: {}, body: markdown };
  const close = markdown.indexOf("\n---", 4);
  if (close === -1) throw new Error("Frontmatter has no closing ---");
  const block = markdown.slice(4, close);
  const afterClose = markdown.indexOf("\n", close + 4);
  const body = afterClose === -1 ? "" : markdown.slice(afterClose + 1);
  const parsed = parse(block) ?? {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Frontmatter is not a mapping");
  }
  return { data: parsed as Record<string, unknown>, body };
}

function readStringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error(`${field} must be a list of strings`);
  }
  return value as string[];
}

function readTriggers(value: unknown): Trigger[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("triggers must be a list");
  return value.map((entry) => {
    if (typeof entry === "string") return entry;
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { text?: unknown }).text === "string" &&
      Number.isInteger((entry as { minCount?: unknown }).minCount)
    ) {
      const { text, minCount } = entry as { text: string; minCount: number };
      return { text, minCount };
    }
    throw new Error(
      "A trigger is a string or { text: string, minCount: integer }"
    );
  });
}

export function readScope(data: Record<string, unknown>): Scope {
  return {
    paths: readStringList(data.paths, "paths"),
    triggers: readTriggers(data.triggers)
  };
}
