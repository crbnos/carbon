// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// react-pdf breaks a line only between words or at the English hyphenation
// points it finds, so an unbroken string wider than the page (a URL, a file
// path) printed past the margin. Plain-text notes break at spaces, and a
// longer word every NOTES_WORD_CHUNK characters. Each piece but the last ends
// in a soft hyphen, the usual mark for a place a word may break.
const NOTES_WORD_CHUNK = 40;
const SOFT_HYPHEN = "\u00AD";

/** The `hyphenationCallback` for a `<Text>` of plain-text notes. */
export function breakLongNotesWord(word: string): string[] {
  if (word.length <= NOTES_WORD_CHUNK) return [word];
  const parts: string[] = [];
  for (let start = 0; start < word.length; start += NOTES_WORD_CHUNK) {
    const end = Math.min(start + NOTES_WORD_CHUNK, word.length);
    const part = word.slice(start, end);
    parts.push(end < word.length ? `${part}${SOFT_HYPHEN}` : part);
  }
  return parts;
}
