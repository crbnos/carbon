// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentTemplateType } from "@carbon/documents/template";
import {
  FOOTER_LINE_TEXT_KEYS,
  HEADER_TEXT_KEYS,
  TOKEN_RE
} from "@carbon/documents/template";
import { normalize, type PrintedText } from "./previewText";

/** Shorter values ("1", "EA") would match inside unrelated text. */
const MIN_VALUE_LENGTH = 3;

/** The end of a word a cell wrapped ("spection"); shorter could be anything. */
const MIN_WRAPPED_PIECE_LENGTH = 5;

/** Shorter texts ("by") would be found inside any sentence. */
const MIN_SHARED_RUN_LENGTH = 10;

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

/**
 * The runs of a page's text layer, a line at a time, and where each run landed:
 * a run starts a new line when it sits lower or higher than the one before it by
 * half its height. A blank run (the space between two words) has no height of
 * its own.
 */
export function groupLines(
  runs: (PageRun & { top: number; height: number })[]
): { lines: PageRun[][]; places: ClickedRun[] } {
  const lines: PageRun[][] = [];
  const places: ClickedRun[] = [];
  let lastTop: number | null = null;
  for (const { text, left, right, top, height } of runs) {
    const blank = !text.trim();
    if (lastTop === null || (!blank && Math.abs(top - lastTop) > height / 2)) {
      lines.push([]);
    }
    if (!blank) lastTop = top;
    const line = lines[lines.length - 1];
    places.push({ line: lines.length - 1, run: line.length });
    line.push({ text, left, right });
  }
  return { lines, places };
}

/**
 * Text as a comparison reads it. The text layer can lose the space between two
 * runs, and headings print in capitals, with the same rule as `toUpperCase` (a
 * "ß" prints "SS").
 */
const squash = (s: string) => s.replace(/\s+/g, "").toUpperCase();

function holdsWords(text: string, part: string) {
  const whole = text.toUpperCase();
  const piece = part.toUpperCase();
  const isWordChar = (c?: string) => !!c && /[\p{L}\p{N}]/u.test(c);
  for (
    let index = whole.indexOf(piece);
    index !== -1;
    index = whole.indexOf(piece, index + 1)
  ) {
    if (
      !isWordChar(whole[index - 1]) &&
      !isWordChar(whole[index + piece.length])
    ) {
      return true;
    }
  }
  return false;
}

/** The runs from `first` to `last` of a line, as a comparison reads them. */
const windowOf = (runs: PageRun[], first: number, last: number) =>
  squash(
    runs
      .slice(first, last + 1)
      .map((run) => run.text)
      .join("")
  );

/**
 * A text with a variable the values do not hold: its words must all print, around
 * whatever the variable printed. A text of nothing but variables and punctuation
 * prints only the record's values, so nothing on the page can be told apart by it.
 */
function wordsAround(text: string): RegExp | null {
  const literal = text.replace(TOKEN_RE, "");
  if (!/[\p{L}\p{N}]/u.test(literal)) return null;
  const body = text
    .split(TOKEN_RE)
    .filter((_, index) => index % 2 === 0)
    .map((part) => squash(part).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+?");
  return new RegExp(`^${body}$`, "su");
}

/**
 * Whether a whole text printed these runs. A value of its own place (a cell, an
 * amount) never does: the column or label beside it finds it, because its figure
 * can also print in another column. So does a value too short to tell apart.
 */
function matcherOf(texts: PrintedText[]) {
  const exact = new Map<string, PrintedText[]>();
  const patterns: { regex: RegExp; text: PrintedText }[] = [];
  for (const text of texts) {
    if (text.row) continue;
    const printed = text.printed?.[0];
    if (printed !== undefined) {
      if (text.onlyValue && (text.of || printed.length < MIN_VALUE_LENGTH)) {
        continue;
      }
      const words = squash(printed);
      exact.set(words, [...(exact.get(words) ?? []), text]);
    } else if (text.text.search(TOKEN_RE) < 0) {
      const words = squash(text.text);
      if (words) exact.set(words, [...(exact.get(words) ?? []), text]);
    } else {
      const regex = wordsAround(text.text);
      if (regex) patterns.push({ regex, text });
    }
  }
  return {
    exact: (words: string) => exact.get(words) ?? [],
    around: (words: string) =>
      patterns.filter(({ regex }) => regex.test(words)).map(({ text }) => text)
  };
}

interface Found {
  /** The runs of the line it printed. */
  first: number;
  last: number;
  left: number;
  right: number;
  text: PrintedText;
}

/**
 * The texts a line printed, left to right, with who could print each. Exact words
 * take the longest stretch of runs; a variable takes the shortest, or it would
 * swallow the rest of the line.
 */
function textsOnLine(runs: PageRun[], matcher: ReturnType<typeof matcherOf>) {
  const found: { first: number; last: number; printers: PrintedText[] }[] = [];
  for (let first = 0; first < runs.length; first++) {
    if (!runs[first].text.trim()) continue;
    const stretches = runs.map((_, last) => last).slice(first);
    const hit =
      [...stretches]
        .reverse()
        .map((last) => ({
          last,
          printers: matcher.exact(windowOf(runs, first, last))
        }))
        .find(({ printers }) => printers.length > 0) ??
      stretches
        .map((last) => ({
          last,
          printers: matcher.around(windowOf(runs, first, last))
        }))
        .find(({ printers }) => printers.length > 0);
    if (hit) {
      found.push({ first, ...hit });
      first = hit.last;
    }
  }
  return found;
}

/**
 * The line that prints the document's title, wrapped or not, or its number when
 * the title is blank, or -1. What prints above is the header's own.
 */
function titleLine(lines: PageRun[][], texts: PrintedText[]) {
  const titles = texts
    .filter(
      (text) =>
        text.scope === "document" &&
        !text.isSection &&
        HEADER_TEXT_KEYS.includes(text.key)
    )
    .map((text) => squash(text.printed?.[0] ?? text.text))
    .filter(Boolean);
  return lines.findIndex((runs, lineIndex) =>
    runs.some((run, first) => {
      if (!run.text.trim()) return false;
      const words = windowOf(runs, first, runs.length - 1);
      const next = windowOf(lines[lineIndex + 1] ?? [], 0, Infinity);
      return titles.some(
        (title) =>
          title === words ||
          (next !== "" &&
            words.length < title.length &&
            title.startsWith(words + next))
      );
    })
  );
}

/**
 * Whether a click landed on what the header prints from its own options (the
 * company's details): above the title, or, when the title is not printed, above
 * every text of the first page.
 */
export function isHeaderDetails(
  lines: PageRun[][],
  clicked: ClickedRun,
  texts: PrintedText[],
  pageNumber: number
) {
  const title = titleLine(lines, texts);
  if (title >= 0) return clicked.line < title;
  if (pageNumber !== 1) return false;
  const matcher = matcherOf(texts);
  const firstText = lines.findIndex(
    (runs) => textsOnLine(runs, matcher).length > 0
  );
  return firstText < 0 || clicked.line < firstText;
}

/** What a click on the footer's own line points at, if it is one of its words. */
export function findFooterText(
  run: string,
  texts: PrintedText[]
): PrintedText | null {
  const words = squash(run);
  return (
    texts.find((text) => words === squash(text.printed?.[0] ?? text.text)) ??
    // The page number prints inside the word: "Page 1 of 2".
    texts.find(
      (text) => text.key === "page" && words.startsWith(squash(text.text))
    ) ??
    null
  );
}

export interface PageClick {
  lines: PageRun[][];
  at: ClickedRun;
  /** How far down the page the clicked run is, from 0 to 1. */
  top: number;
  pageNumber: number;
  /** The PDF that printed the page. */
  file: string;
}

/** How far down the page the footer's line starts; the page's own text stops above it. */
const FOOTER_TOP = 0.945;

/**
 * What a click on the preview opens. `exact` says the click landed on that text;
 * otherwise it landed on something its panel configures, such as the company's
 * details or the registration line.
 */
export function resolveClick(
  { lines, at, top, pageNumber }: PageClick,
  documentType: DocumentTemplateType,
  texts: PrintedText[]
): { scope: string; key: string; exact: boolean } | null {
  // A section's paragraphs print above the line, so they are found as text.
  const isFooterLine = (text: PrintedText) =>
    text.scope === "document" &&
    !text.isSection &&
    FOOTER_LINE_TEXT_KEYS.includes(text.key);

  // A label has no page around it.
  if (documentType !== "trackingLabel") {
    // The footer repeats on every page, under whatever block ends it. Only its
    // own words are texts; the registration line and the document id are not.
    if (top >= FOOTER_TOP) {
      const footer = findFooterText(
        lines[at.line]?.[at.run]?.text ?? "",
        texts.filter(isFooterLine)
      );
      return footer
        ? { scope: footer.scope, key: footer.key, exact: true }
        : { scope: "document", key: "page", exact: false };
    }
    if (isHeaderDetails(lines, at, texts, pageNumber)) {
      return { scope: "document", key: "title", exact: false };
    }
  }

  const hit = findPrintedText(
    lines,
    at,
    texts.filter((text) => !isFooterLine(text))
  );
  return (
    hit && {
      scope: hit.scope,
      key: hit.key,
      exact: !hit.nearby && !hit.isSection
    }
  );
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
 * because one text can be split into runs ("-", "Tax"). A text must print whole
 * runs, so the "of" in "Set of 4 bolts" and the "Total" in "Total Station" are
 * not the footer's or the table's. Texts that print the same words ("Total" in
 * the table and in the summary) are told apart by print order.
 *
 * A click on a value points at the text that prints it: the value of the label
 * on its line, else what printed these words in the table column it sits under,
 * else whatever printed these words, or holds them as a piece of a wrapped line,
 * else the column's value, else the nearest text above it in the same column of
 * the page.
 */
export function findPrintedText(
  lines: PageRun[][],
  clicked: ClickedRun,
  texts: PrintedText[]
): (PrintedText & { nearby?: boolean }) | null {
  const clickedRun = lines[clicked.line]?.[clicked.run];
  if (!clickedRun || !clickedRun.text.trim()) return null;

  const start = Math.max(titleLine(lines, texts), 0);
  if (clicked.line < start) return null;

  const matcher = matcherOf(texts);
  const valueOf = (text: PrintedText) =>
    texts.find((t) => t.scope === text.scope && t.of === text.key) ?? text;

  // Every stretch of runs around the click, as a comparison reads it.
  const clickedLine = lines[clicked.line];
  const windows: string[] = [];
  for (let first = 0; first <= clicked.run; first++) {
    for (let last = clicked.run; last < clickedLine.length; last++) {
      windows.push(windowOf(clickedLine, first, last));
    }
  }
  // And every stretch that ends just before it.
  const before = clickedLine
    .slice(0, clicked.run)
    .flatMap((_, first) =>
      clickedLine
        .slice(first, clicked.run)
        .map((__, length) => windowOf(clickedLine, first, first + length))
    );
  const piece = normalize(clickedRun.text);
  // Exactly what these runs print, or a stretch of a longer text that holds them.
  const printsExactly = (text: PrintedText) =>
    text.printed?.some((printed) => windows.includes(squash(printed))) ?? false;
  const printsPiece = (text: PrintedText) =>
    text.printed?.some((printed) => {
      // A value too long for its cell prints cut short, or breaks inside a word.
      if (piece.length > 1 && /[…-]$/.test(piece)) {
        return squash(printed).includes(squash(piece.slice(0, -1)));
      }
      if (text.row && piece.length >= MIN_WRAPPED_PIECE_LENGTH) {
        return squash(printed).includes(squash(piece));
      }
      return (
        (piece.length >= MIN_VALUE_LENGTH && holdsWords(printed, piece)) ||
        // A text and the words after it can share one run.
        (printed.length >= MIN_SHARED_RUN_LENGTH && holdsWords(piece, printed))
      );
    }) ?? false;
  const printedHere = (text: PrintedText) =>
    printsExactly(text) || printsPiece(text);

  const rowWords = new Set(
    texts.flatMap((text) =>
      text.row
        ? (text.printed ?? []).map(
            (printed) => `${text.scope}:${squash(printed)}`
          )
        : []
    )
  );
  const used = new Set<PrintedText>();
  let lastPrinted = -1;
  let lastScope: string | null = null;
  let above: Found[] = [];
  let header: Found[] | null = null;

  for (let lineIndex = start; lineIndex <= clicked.line; lineIndex++) {
    const runs = lines[lineIndex];
    // In a table, a cell can print a text's words ("Supplier" as an item's id).
    const scope: string | undefined = header?.[0]?.text.scope;
    const onLine: ReturnType<typeof textsOnLine> = textsOnLine(
      runs,
      matcher
    ).filter(
      ({ first, last }) =>
        !scope || !rowWords.has(`${scope}:${windowOf(runs, first, last)}`)
    );
    const kept: Found[] = onLine.map(({ first, last, printers }): Found => {
      // A column's heading prints in a row of headings, never alone in a cell.
      const cells = printers.filter((text) => text.kind !== "column");
      const printed = onLine.length < 2 && cells.length > 0 ? cells : printers;
      // Texts print in order, so one before the last text found did not print
      // here: its block left it out ("Supplier:" with no linked supplier). A
      // block that repeats (one box per task) starts its order over.
      const unused = printed.filter((candidate) => !used.has(candidate));
      const text =
        unused.find((candidate) => texts.indexOf(candidate) >= lastPrinted) ??
        unused.find((candidate) => candidate.scope === lastScope) ??
        printed[0];
      used.add(text);
      lastScope = text.scope;
      lastPrinted = Math.max(lastPrinted, texts.indexOf(text));
      return {
        first,
        last,
        left: runs[first].left,
        right: runs[last].right,
        text
      };
    });

    if (lineIndex === clicked.line) {
      const own = kept.find(
        (found) => found.first <= clicked.run && clicked.run <= found.last
      )?.text;
      // A half-point of give: pdf.js places runs of one column a hair apart.
      const left = clickedRun.left + 0.5;
      // The page's other column prints on the same lines. A label belongs to
      // another column when a heading of its block starts between it and the click.
      const label = kept.filter((found) => found.last < clicked.run).at(-1);
      const labelHere =
        label &&
        !above.some(
          (found) =>
            found.text.kind === "heading" &&
            found.text.scope === label.text.scope &&
            found.left >= label.right &&
            found.left <= left
        )
          ? label.text
          : null;
      // A value printed elsewhere too belongs to the label beside it here.
      if (own && !(own.onlyValue && labelHere)) return own;
      if (labelHere) {
        const value = valueOf(labelHere);
        if (value !== labelHere && printsExactly(value)) return value;
        // A row's own text after a label on its line ("Item: BOLT - Qty: 12"), or
        // words with no value of their own ("Supplier" before an action's name).
        return (
          texts.find(
            (t) => t.row && t.scope === labelHere.scope && printsExactly(t)
          ) ??
          (value !== labelHere ? value : null) ??
          texts.find(
            (t) => t.row && t.scope === labelHere.scope && printedHere(t)
          ) ??
          labelHere
        );
      }

      // A row's own label before the click ("Tax (6%)", then its amount).
      const rowLabel = texts.find(
        (t) =>
          t.row &&
          valueOf(t) !== t &&
          t.printed?.some((printed) => before.includes(squash(printed)))
      );
      if (rowLabel && printsExactly(valueOf(rowLabel))) {
        return valueOf(rowLabel);
      }

      const column = header && columnAt(header, clickedRun.left);
      if (column) {
        const inColumn = texts.find(
          (t) =>
            t.scope === column.scope && t.of === column.key && printedHere(t)
        );
        if (inColumn) return inColumn;
      }
      // The longest text that printed these words: "2026, quoting reference X"
      // is the sentence's end, not the X inside it.
      const printer = texts
        .filter(
          (t) =>
            printedHere(t) &&
            // One digit outside a table is no telling whose it is; "US" is.
            ((column && t.scope === column.scope) ||
              t.row !== undefined ||
              /\p{L}/u.test(t.printed?.join("") ?? ""))
        )
        .sort(
          (a, b) =>
            Number(b.scope === column?.scope) -
              Number(a.scope === column?.scope) ||
            (b.printed?.[0]?.length ?? 0) - (a.printed?.[0]?.length ?? 0)
        )[0];
      if (printer) return printer;
      if (column) return valueOf(column);

      // The nearest text above that starts where this value starts, else the
      // nearest to its left. It did not print these words: its panel is near.
      const earlier = above.filter((found) => found.left <= left);
      const nearest = (
        earlier.filter((found) => found.left >= clickedRun.left - 2).at(-1) ??
        earlier.at(-1) ??
        above.at(-1)
      )?.text;
      return nearest ? { ...nearest, nearby: true } : null;
    }

    if (
      kept.length >= 2 &&
      kept.some((found) => found.text.kind === "column")
    ) {
      header = kept;
    } else if (
      kept.some((found) => found.text.scope !== header?.[0].text.scope)
    ) {
      // A line of the block's own ("Tax & Fees") stays in the table; another
      // block's text ends it.
      header = null;
    }
    above = [...above, ...kept];
  }

  return null;
}
