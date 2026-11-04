// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  DocumentBlock,
  DocumentSettings,
  DocumentTemplateType
} from "@carbon/documents/template";
import { getTextEntries } from "@carbon/documents/template";

/** A text the template prints: who edits it (`scope`), its key, and its text. */
export interface PrintedText {
  /** A block id, or "document" for the template's own texts. */
  scope: string;
  key: string;
  /** The text as stored, `{tokens}` included. */
  text: string;
}

/**
 * Every text the preview can show, in print order: the title with the header,
 * each visible block's texts in block order, then the other document texts
 * (the footer prints last). Hidden texts print nothing, so they are left out.
 */
export function printedTexts(
  documentType: DocumentTemplateType,
  blocks: DocumentBlock[],
  settings: Pick<DocumentSettings, "text" | "hidden">
): PrintedText[] {
  const documentTexts = getTextEntries(documentType, "document")
    .filter((entry) => !settings.hidden?.includes(entry.key))
    .map((entry) => ({
      scope: "document",
      key: entry.key,
      text: settings.text?.[entry.key] ?? entry.default
    }));
  const title = documentTexts.filter((t) => t.key === "title");

  const blockTexts = blocks
    .filter((block) => block.visible)
    .flatMap((block) => [
      ...(block.type === "header" ? title : []),
      ...getTextEntries(documentType, block.type)
        .filter((entry) => !block.hidden?.includes(entry.key))
        .map((entry) => ({
          scope: block.id,
          key: entry.key,
          text: block.text?.[entry.key] ?? entry.default
        }))
    ]);

  return [...blockTexts, ...documentTexts.filter((t) => t.key !== "title")];
}

/** Where a click landed: the line of the page, and the run within it. */
export interface ClickedRun {
  line: number;
  run: number;
}

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * A pattern for a printed text: case-insensitive (headings print in capitals),
 * any whitespace between words, each `{token}` matching what it printed, and
 * whole words only, so "Customer" is not found inside "Customers".
 */
function pattern(text: string): RegExp {
  const body = normalize(text)
    .split(/\{[^}]+\}/)
    .map((part) =>
      part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")
    )
    .join(".+?");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

interface Found {
  start: number;
  end: number;
  /** Every text that prints these words, in print order. */
  texts: PrintedText[];
}

/**
 * Which text a click on the preview points at. Runs are read a line at a time,
 * because one text can be split into runs ("-", "Tax") and one run can hold a
 * label and its value. On each line the longest texts win, left to right.
 * Texts that print the same words ("Total" in the table and in the summary)
 * are told apart by order: the n-th "Total" on the page is the n-th text that
 * prints it. A click on a value points at the nearest text before it (the
 * label on its line, else the heading above it).
 */
export function findPrintedText(
  lines: string[][],
  clicked: ClickedRun,
  texts: PrintedText[]
): PrintedText | null {
  const clickedRun = lines[clicked.line]?.[clicked.run];
  if (!clickedRun || !clickedRun.trim()) return null;

  const byWords = new Map<string, PrintedText[]>();
  for (const text of texts) {
    const words = normalize(text.text).toLowerCase();
    if (!words) continue;
    byWords.set(words, [...(byWords.get(words) ?? []), text]);
  }
  const patterns = [...byWords.entries()].map(([words, matching]) => ({
    regex: pattern(matching[0].text),
    texts: matching,
    words
  }));

  const seen = new Map<string, number>();
  let hit: PrintedText | null = null;
  let before: PrintedText | null = null;

  lines.forEach((runs, lineIndex) => {
    const line = runs.join("");
    const found: (Found & { words: string })[] = [];
    for (const { regex, texts: matching, words } of patterns) {
      for (const match of line.matchAll(regex)) {
        found.push({
          start: match.index,
          end: match.index + match[0].length,
          texts: matching,
          words
        });
      }
    }
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept: (Found & { text: PrintedText })[] = [];
    for (const f of found) {
      if (kept.length > 0 && f.start < kept[kept.length - 1].end) continue;
      const n = seen.get(f.words) ?? 0;
      seen.set(f.words, n + 1);
      kept.push({ ...f, text: f.texts[n % f.texts.length] });
    }

    if (lineIndex > clicked.line) return;
    if (lineIndex < clicked.line) {
      if (kept.length > 0) before = kept[kept.length - 1].text;
      return;
    }
    const offset = runs.slice(0, clicked.run).join("").length;
    const end = offset + clickedRun.length;
    hit =
      kept.find((f) => f.start < end && offset < f.end)?.text ??
      kept.filter((f) => f.end <= offset).at(-1)?.text ??
      before;
  });

  return hit;
}
