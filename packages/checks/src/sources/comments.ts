// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Several checks blank the same files, so each text is blanked once.
const blanked = new Map<string, string>();
const masked = new Map<string, string>();

/**
 * Replace TS/JS comment text with spaces (newlines kept, so offsets and line
 * numbers survive). String contents are left alone.
 */
export function blankComments(src: string): string {
  let known = blanked.get(src);
  if (known === undefined) {
    known = blankText(src);
    blanked.set(src, known);
  }
  return known;
}

function blankText(src: string): string {
  const comments: Range[] = [];
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      comments.push([i, stop]);
      i = stop;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      // The search starts at the opening slash, so `/*/` closes itself.
      const end = src.indexOf("*/", i);
      const stop = end === -1 ? src.length : end + 2;
      comments.push([i, stop]);
      i = stop;
      continue;
    }
    i++;
  }
  return blankRanges(src, comments);
}

/** `[from, to)` offsets into a text. */
type Range = [from: number, to: number];

/**
 * `src` with every character of `ranges` but a newline turned into a space.
 * The ranges are in order and do not overlap.
 */
function blankRanges(src: string, ranges: Range[]): string {
  const parts: string[] = [];
  let kept = 0;
  for (const [from, to] of ranges) {
    parts.push(src.slice(kept, from));
    const end = Math.min(to, src.length);
    let at = from;
    let newline = src.indexOf("\n", at);
    while (newline !== -1 && newline < end) {
      parts.push(" ".repeat(newline - at), "\n");
      at = newline + 1;
      newline = src.indexOf("\n", at);
    }
    parts.push(" ".repeat(end - at));
    kept = end;
  }
  parts.push(src.slice(kept));
  return parts.join("");
}

/**
 * Blank the INTERIOR of comments and string/template literals, preserving every
 * character position and newline so reported line numbers stay exact.
 *
 * Two failures this fixes, both demonstrated by tests below:
 * - A `.transform(f).default(x)` written inside a string or a doc comment was
 *   reported as a real violation.
 * - A comment BETWEEN the effect and `.default()` hid a genuine violation:
 *   `receiverBefore` stops at `/`, so the receiver never reached the
 *   `.transform(` and the site was silently skipped. That direction is the
 *   dangerous one — a missed violation looks identical to a clean file.
 *
 * Regex literals are deliberately not tracked: telling `/` division from a
 * regex needs real parsing, and a regex containing `.default(` preceded by an
 * effect is not a shape that occurs here.
 */
export function maskCommentsAndStrings(contents: string): string {
  let known = masked.get(contents);
  if (known === undefined) {
    known = maskText(contents);
    masked.set(contents, known);
  }
  return known;
}

function maskText(contents: string): string {
  const interiors: Range[] = [];
  let i = 0;
  while (i < contents.length) {
    const c = contents[i];
    const next = contents[i + 1];

    if (c === "/" && next === "/") {
      const end = contents.indexOf("\n", i);
      const stop = end === -1 ? contents.length : end;
      interiors.push([i, stop]);
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = contents.indexOf("*/", i + 2);
      const stop = end === -1 ? contents.length : end + 2;
      interiors.push([i, stop]);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < contents.length) {
        if (contents[j] === "\\") {
          j += 2;
          continue;
        }
        if (contents[j] === quote) break;
        j++;
      }
      // Keep the quotes themselves so the receiver walk still sees a literal
      // boundary rather than bare whitespace.
      interiors.push([i + 1, j]);
      i = j + 1;
      continue;
    }
    i++;
  }
  return blankRanges(contents, interiors);
}
