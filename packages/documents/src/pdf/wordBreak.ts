// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** Splits a word longer than `size` into pieces of `size` characters. */
export function chunkWord(word: string, size: number): string[] {
  if (word.length <= size) return [word];
  const parts: string[] = [];
  for (let start = 0; start < word.length; start += size) {
    parts.push(word.slice(start, start + size));
  }
  return parts;
}
