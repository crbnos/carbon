// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { chunkWord } from "./wordBreak";

// react-pdf breaks a line only between words or at the English hyphenation
// points it finds, so an unbroken string wider than the page (a URL, a file
// path) printed past the margin. Plain-text notes break at spaces, and a
// longer word every NOTES_WORD_CHUNK characters. Textkit draws the hyphen at
// the break. No soft hyphen in the pieces: each one moves the later breaks a
// character past these boundaries, splitting "[080]" as "[0-" and "80]".
const NOTES_WORD_CHUNK = 40;

/** The `hyphenationCallback` for a `<Text>` of plain-text notes. */
export function breakLongNotesWord(word: string): string[] {
  return chunkWord(word, NOTES_WORD_CHUNK);
}
