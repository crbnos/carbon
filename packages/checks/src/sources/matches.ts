// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Violation } from "../check";
import { lineOf } from "./text";

/** What a violation says, before it is placed at a file and line. */
export type Hit = { snippet: string; message: string };

/** A global pattern that is a violation wherever it matches, and why. */
export type Banned = { pattern: RegExp; message: string };

/**
 * Each match of each `banned` pattern in `text`, pattern by pattern, with the
 * matched text as its snippet.
 */
export function bannedHits(text: string, banned: readonly Banned[]): Hit[] {
  const hits: Hit[] = [];
  for (const { pattern, message } of banned) {
    for (const match of text.matchAll(pattern)) {
      hits.push({ snippet: match[0], message });
    }
  }
  return hits;
}

/**
 * A violation for each hit `hitsOn` finds on each line of `contents` that
 * `mayMatch` (a pattern without the `g` flag) matches, line by line. For a
 * rule that a single line shows. `mayMatch` is text every hit's line
 * contains: testing it here rather than in `hitsOn` keeps the scan of a large
 * file fast, since most lines then cost one regex test and no call.
 */
export function lineViolations(
  file: string,
  contents: string,
  mayMatch: RegExp,
  hitsOn: (line: string) => Hit[]
): Violation[] {
  const violations: Violation[] = [];
  contents.split("\n").forEach((text, i) => {
    if (!mayMatch.test(text)) return;
    for (const hit of hitsOn(text)) {
      violations.push({ file, line: i + 1, ...hit });
    }
  });
  return violations;
}

/**
 * A violation for each match of the global `pattern` in `contents`, at the
 * line the match starts on. For a rule whose match may span lines. `hit` says
 * what the match is.
 */
export function matchViolations(
  file: string,
  contents: string,
  pattern: RegExp,
  hit: (match: RegExpExecArray) => Hit
): Violation[] {
  return [...contents.matchAll(pattern)].map((match) => ({
    file,
    line: lineOf(contents, match.index),
    ...hit(match)
  }));
}
