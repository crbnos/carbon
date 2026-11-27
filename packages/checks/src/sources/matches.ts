// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Violation } from "../check";
import { lineOf } from "./text";

/** A global pattern that is a violation wherever it matches, and why. */
export type Banned = { pattern: RegExp; message: string };

/**
 * What a check bans, as data: the patterns, where they are looked for, what a
 * violation's snippet is (a baseline key, so it is chosen, never guessed), the
 * files that are exempt, and text that every match contains.
 *
 * - `within: "file"`: a match may span lines; its violation is at the line it
 *   starts on.
 * - `within: "line"`: each line is searched on its own.
 * - `snippet: "match"`: the matched text as is.
 * - `snippet: "collapsed-match"`: the matched text, each run of whitespace one
 *   space.
 * - `snippet: "trimmed-line"`: the whole line, trimmed. Within a line, a line
 *   gives one violation per pattern it matches, however often it matches it;
 *   within a file, each match gives one, with the line it starts on.
 */
export type Bans = {
  banned: readonly Banned[];
  /** Exempt files: an exact path, or a pattern the path matches. */
  except?: readonly (string | RegExp)[];
  /**
   * A pattern without the `g` flag that every match contains. A file, and a
   * line when `within: "line"`, that does not contain it is skipped: on a
   * large input most lines then cost one regex test.
   */
  mayContain?: RegExp;
} & (
  | {
      within: "file";
      snippet: "match" | "collapsed-match" | "trimmed-line";
    }
  | { within: "line"; snippet: "match" | "collapsed-match" | "trimmed-line" }
);

/** Each match of each banned pattern in one file, pattern by pattern. */
export function findBanned(
  file: string,
  contents: string,
  bans: Bans
): Violation[] {
  const { banned, except, mayContain } = bans;
  if (
    except?.some((path) =>
      typeof path === "string" ? path === file : path.test(file)
    )
  ) {
    return [];
  }
  if (mayContain && !mayContain.test(contents)) return [];
  if (bans.within === "file") {
    const snippet = bans.snippet;
    if (snippet === "trimmed-line") {
      const lines = contents.split("\n");
      return banned.flatMap(({ pattern, message }) =>
        [...contents.matchAll(pattern)].map((match) => {
          const line = lineOf(contents, match.index);
          return {
            file,
            line,
            snippet: lines[line - 1]?.trim() ?? "",
            message
          };
        })
      );
    }
    return banned.flatMap(({ pattern, message }) =>
      matchViolations(file, contents, pattern, (match) => ({
        snippet: snippetOf(match[0], snippet),
        message
      }))
    );
  }
  const violations: Violation[] = [];
  const lines = contents.split("\n");
  if (bans.snippet === "trimmed-line") {
    lines.forEach((text, i) => {
      if (mayContain && !mayContain.test(text)) return;
      for (const { pattern, message } of banned) {
        // `test` is the fast way to ask (`search` builds the match), and a
        // global pattern's `test` starts where its last match ended.
        pattern.lastIndex = 0;
        if (pattern.test(text)) {
          violations.push({ file, line: i + 1, snippet: text.trim(), message });
        }
      }
    });
    return violations;
  }
  const snippet = bans.snippet;
  lines.forEach((text, i) => {
    if (mayContain && !mayContain.test(text)) return;
    for (const { pattern, message } of banned) {
      for (const match of text.matchAll(pattern)) {
        violations.push({
          file,
          line: i + 1,
          snippet: snippetOf(match[0], snippet),
          message
        });
      }
    }
  });
  return violations;
}

function snippetOf(matched: string, snippet: "match" | "collapsed-match") {
  return snippet === "match" ? matched : matched.replace(/\s+/g, " ");
}

/**
 * A violation for each match of the global `pattern` in `contents`, at the
 * line the match starts on. `hit` says what the match is: for a rule whose
 * snippet or message is built from the match.
 */
export function matchViolations(
  file: string,
  contents: string,
  pattern: RegExp,
  hit: (match: RegExpExecArray) => { snippet: string; message: string }
): Violation[] {
  return [...contents.matchAll(pattern)].map((match) => ({
    file,
    line: lineOf(contents, match.index),
    ...hit(match)
  }));
}
