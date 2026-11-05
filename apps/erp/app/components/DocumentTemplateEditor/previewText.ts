// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type {
  DocumentBlock,
  DocumentSettings,
  DocumentTemplateType
} from "@carbon/documents/template";
import {
  DEFAULT_SUMMARY_OPTIONS,
  getTextEntries,
  HEADER_TEXT_KEYS,
  type TextEntry,
  type TextKind,
  TOKEN_RE
} from "@carbon/documents/template";

/** The summary's tax amount, in every document that has a summary. */
const TAX_AMOUNT_KEY = "taxValue";

/** A text the template prints: who edits it (`scope`), its key, and its text. */
export interface PrintedText {
  /** A block id, or "document" for the template's own texts. */
  scope: string;
  key: string;
  /** The text as stored, `{tokens}` included. */
  text: string;
  kind: TextKind;
  /** The column or label this value belongs to. */
  of?: string;
}

/** A text the template prints: who edits it, and what it stores. */
export interface PrintedEntry {
  scope: string;
  /** The block that prints it; null for the template's own texts. */
  block: DocumentBlock | null;
  entry: TextEntry;
  stored: { text?: Record<string, string>; hidden?: string[] };
}

/**
 * Every text the template prints, in print order: the title with the header,
 * each visible block's texts in block order, then the other document texts
 * (the footer prints last). Hidden texts print nothing, so they are left out.
 */
export function printedEntries(
  documentType: DocumentTemplateType,
  blocks: DocumentBlock[],
  settings: Pick<DocumentSettings, "text" | "hidden">
): PrintedEntry[] {
  const ofTexts = (
    scope: string,
    block: PrintedEntry["block"],
    entries: readonly TextEntry[],
    stored: PrintedEntry["stored"]
  ) =>
    entries
      .filter(
        (entry) =>
          !stored.hidden?.includes(entry.key) &&
          !(entry.of && stored.hidden?.includes(entry.of))
      )
      .map((entry) => ({ scope, block, entry, stored }));

  const documentEntries = getTextEntries(documentType, "document");
  const inHeader = (entry: TextEntry) => HEADER_TEXT_KEYS.includes(entry.key);
  return [
    ...blocks
      .filter((block) => block.visible)
      .flatMap((block) => [
        ...(block.type === "header"
          ? ofTexts(
              "document",
              null,
              documentEntries.filter(inHeader),
              settings
            )
          : []),
        ...ofTexts(
          block.id,
          block,
          getTextEntries(documentType, block.type),
          block
        )
      ]),
    ...ofTexts(
      "document",
      null,
      documentEntries.filter((entry) => !inHeader(entry)),
      settings
    )
  ];
}

/** Every text the preview can show, in print order, with the words it prints. */
export function printedTexts(
  documentType: DocumentTemplateType,
  blocks: DocumentBlock[],
  settings: Pick<DocumentSettings, "text" | "hidden">
): PrintedText[] {
  return printedEntries(documentType, blocks, settings).flatMap(
    ({ scope, block, entry, stored }) => {
      const text: PrintedText = {
        scope,
        key: entry.key,
        text: stored.text?.[entry.key] ?? entry.default,
        kind: entry.kind,
        of: entry.of
      };
      // The tax row's label is the summary's own option, not a catalog text. A
      // click on it, or on its amount, goes to the amount's row.
      if (block?.type !== "summary" || entry.key !== TAX_AMOUNT_KEY) {
        return [text];
      }
      const label =
        block.options?.taxLabel?.trim() || DEFAULT_SUMMARY_OPTIONS.taxLabel;
      return [
        { ...text, kind: "text" as const, text: `${label} ({currency})` },
        text
      ];
    }
  );
}

/**
 * What a text is called in the panel: its words before any variable ("PO
 * Number"), else the names of its variables ("Supplier Name").
 */
export function wordName(text: string, labels: Record<string, string>) {
  const first = text.search(TOKEN_RE);
  const words = (first < 0 ? text : text.slice(0, first))
    .replace(/[\s:(\-–]+$/u, "")
    .trim();
  if (words) return words;
  return [...text.matchAll(TOKEN_RE)]
    .map((match) => labels[match[1]] ?? match[0])
    .join(" ");
}

/**
 * The texts of a block in the boxes they print in: a heading starts a group, and
 * so does a table column with its per-row values. Texts before the first group
 * stand on their own, under no title.
 */
export function groupTexts(
  entries: readonly TextEntry[],
  labels: Record<string, string>
) {
  const groups: { id: string; title: string | null; entries: TextEntry[] }[] =
    [];
  for (const entry of entries) {
    const starts =
      entry.kind === "heading" ||
      entry.kind === "column" ||
      entries.some((e) => e.row && e.of === entry.key);
    if (starts || groups.length === 0) {
      groups.push({
        id: entry.key,
        title: starts ? wordName(entry.default, labels) : null,
        entries: []
      });
    }
    groups[groups.length - 1].entries.push(entry);
  }
  return groups;
}

/** A run of text in the preview, and where it sits across the page. */
export interface PageRun {
  text: string;
  left: number;
  right: number;
}

/** Where a click landed: the line of the page, and the run within it. */
export interface ClickedRun {
  line: number;
  run: number;
}

export const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * A text of nothing but `{tokens}` and punctuation ("{line.quantity}",
 * "{source.type}: {source.id}") prints only the record's values, so nothing on
 * the page can be told apart by it. A text with no tokens is matched as it is
 * ("#").
 */
const hasWords = (text: string) => {
  const literal = text.replace(TOKEN_RE, "");
  return literal === text
    ? literal.trim() !== ""
    : /[\p{L}\p{N}]/u.test(literal);
};

/** Two texts with the same words print the same, whatever their variables. */
const wordsOf = (text: string) =>
  normalize(text.replace(TOKEN_RE, "{}")).toLowerCase();

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
  left: number;
  right: number;
  text: PrintedText;
}

/**
 * The column a table cell sits under: each column starts halfway between its
 * heading and the heading before it. A cell's left edge decides, because a long
 * description runs far past its short heading.
 */
function columnAt(headers: Found[], left: number): PrintedText {
  let column = headers[0];
  for (let i = 1; i < headers.length; i++) {
    if (left >= (headers[i - 1].right + headers[i].left) / 2) {
      column = headers[i];
    }
  }
  return column.text;
}

/**
 * Which text a click on the preview points at. Runs are read a line at a time,
 * because one text can be split into runs ("-", "Tax") and one run can hold a
 * label and its value. A text must start where a run starts, so the "of" in
 * "Set of 4 bolts" is not the footer's "of". On each line the longest texts win,
 * left to right. Texts that print the same words ("Total" in the table and in
 * the summary) are told apart by order: the n-th "Total" on the page is the n-th
 * text that prints it.
 *
 * A click on a value points at the text that prints it: the value of the label
 * on its line, else the value of the table column it sits under, else the nearest
 * text above it in the same column of the page.
 */
export function findPrintedText(
  lines: PageRun[][],
  clicked: ClickedRun,
  texts: PrintedText[]
): PrintedText | null {
  const clickedRun = lines[clicked.line]?.[clicked.run];
  if (!clickedRun || !clickedRun.text.trim()) return null;

  const byWords = new Map<string, PrintedText[]>();
  for (const text of texts) {
    if (!hasWords(text.text)) continue;
    const words = wordsOf(text.text);
    byWords.set(words, [...(byWords.get(words) ?? []), text]);
  }
  const patterns = [...byWords.entries()].map(([words, matching]) => ({
    regex: pattern(matching[0].text),
    texts: matching,
    words
  }));

  const valueOf = (text: PrintedText) =>
    texts.find((t) => t.scope === text.scope && t.of === text.key) ?? text;

  const seen = new Map<string, number>();
  let above: Found[] = [];
  let header: Found[] | null = null;

  for (let lineIndex = 0; lineIndex <= clicked.line; lineIndex++) {
    const runs = lines[lineIndex];
    const line = runs.map((run) => run.text).join("");
    const starts = runs.map(
      (_, i) =>
        runs
          .slice(0, i)
          .map((run) => run.text)
          .join("").length
    );

    const matches: { start: number; end: number; words: string }[] = [];
    for (const { regex, words } of patterns) {
      for (const match of line.matchAll(regex)) {
        if (!starts.includes(match.index)) continue;
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          words
        });
      }
    }
    matches.sort((a, b) => a.start - b.start || b.end - a.end);

    const kept: Found[] = [];
    let lastEnd = -1;
    for (const { start, end, words } of matches) {
      if (start < lastEnd) continue;
      lastEnd = end;
      const printed = patterns.find((p) => p.words === words)?.texts ?? [];
      const n = seen.get(words) ?? 0;
      seen.set(words, n + 1);
      const covered = runs.filter(
        (run, i) => starts[i] < end && starts[i] + run.text.length > start
      );
      kept.push({
        start,
        end,
        left: Math.min(...covered.map((run) => run.left)),
        right: Math.max(...covered.map((run) => run.right)),
        text: printed[n % printed.length]
      });
    }

    if (lineIndex === clicked.line) {
      const offset = starts[clicked.run];
      const end = offset + clickedRun.text.length;
      const own = kept.find((f) => f.start < end && offset < f.end)?.text;
      if (own) return own;
      // A half-point of give: pdf.js places runs of one column a hair apart.
      const left = clickedRun.left + 0.5;
      // The page's other column prints on the same lines. A label belongs to
      // another column when a heading starts between it and the click.
      const label = kept.filter((f) => f.end <= offset).at(-1);
      const acrossColumns =
        label &&
        above.some(
          (f) =>
            f.text.kind === "heading" && f.left >= label.right && f.left <= left
        );
      if (label && !acrossColumns) return valueOf(label.text);
      if (header) return valueOf(columnAt(header, clickedRun.left));
      // The nearest text above that starts where this value starts, else the
      // nearest to its left.
      const earlier = above.filter((f) => f.left <= left);
      return (
        (
          earlier.filter((f) => f.left >= clickedRun.left - 2).at(-1) ??
          earlier.at(-1)
        )?.text ?? null
      );
    }

    if (kept.length >= 2 && kept.some((f) => f.text.kind === "column")) {
      header = kept;
    } else if (kept.some((f) => f.text.scope !== header?.[0].text.scope)) {
      // A line of the block's own ("Tax & Fees") stays in the table; another
      // block's text ends it.
      header = null;
    }
    above = [...above, ...kept];
  }

  return null;
}
