// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { parse } from "yaml";
import { readScope, type Trigger } from "./scope";

/**
 * One lesson inside a topic file (.ai/lessons/<topic>.md). Each `## ` section
 * is one lesson and starts with a fenced `scope` block:
 *
 *     ## Count invoices by the status the list shows
 *     ```scope
 *     id: count-invoices-by-the-status-the-list-shows
 *     paths: ["apps/erp/app/modules/*\/ui/**\/*Dashboard*"]
 *     triggers: ["purchaseInvoices"]
 *     ```
 */
export type LessonSection = {
  id: string;
  title: string;
  paths: string[];
  triggers: Trigger[];
  /** The paragraph after **Rule:**, on one line. */
  rule: string;
  /** The section text after the scope block. */
  body: string;
};

const FENCE = /^(```|~~~)/;

/** Splits a markdown body at `## ` headings that are outside code fences. */
function sections(markdown: string): { title: string; text: string }[] {
  const out: { title: string; lines: string[] }[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) {
      out.push({ title: line.slice(3).trim(), lines: [] });
    } else if (out.length > 0) {
      out[out.length - 1]?.lines.push(line);
    }
  }
  return out.map((s) => ({ title: s.title, text: s.lines.join("\n") }));
}

export function ruleParagraph(body: string): string {
  const at = body.indexOf("**Rule:**");
  if (at === -1) return "";
  const rest = body.slice(at + "**Rule:**".length);
  const end = rest.search(/\n\s*\n/);
  return (end === -1 ? rest : rest.slice(0, end)).replace(/\s+/g, " ").trim();
}

/**
 * Every lesson in one topic file. Throws on a section with no scope block or
 * a scope that does not parse: such a lesson could never be selected.
 */
export function parseLessonFile(
  markdown: string,
  file: string
): LessonSection[] {
  return sections(markdown).map(({ title, text }) => {
    const match = text.match(/^\s*```scope\n([\s\S]*?)\n```\n?/);
    if (!match) throw new Error(`${file}: "${title}" has no \`\`\`scope block`);
    const data = parse(match[1] ?? "") ?? {};
    if (typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`${file}: "${title}" scope is not a mapping`);
    }
    const id = (data as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`${file}: "${title}" scope has no id`);
    }
    const body = text.slice(match[0].length).trim();
    return {
      id,
      title,
      ...readScope(data as Record<string, unknown>),
      rule: ruleParagraph(body),
      body
    };
  });
}

/** The text of one lesson section, scope block first. */
export function formatLessonSection(lesson: {
  id: string;
  title: string;
  paths: string[];
  triggers: Trigger[];
  body: string;
}): string {
  // JSON is valid YAML, and it quotes every glob and trigger safely.
  const list = (values: unknown[]) => JSON.stringify(values);
  return [
    `## ${lesson.title}`,
    "",
    "```scope",
    `id: ${lesson.id}`,
    `paths: ${list(lesson.paths)}`,
    `triggers: ${list(lesson.triggers)}`,
    "```",
    "",
    lesson.body.trim()
  ].join("\n");
}
