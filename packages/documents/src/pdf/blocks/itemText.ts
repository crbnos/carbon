// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LineItemsOptions } from "../../template";
import { chunkWord } from "../wordBreak";

/**
 * Style for the line-item title/description text. With `truncate`, clamp to a
 * single line with an ellipsis; with `wrap` (default), let it flow onto new
 * lines (which grows the row height). Shared by every document's LineItemsBlock.
 */
export function itemTextOverflowStyle(options?: Partial<LineItemsOptions>): {
  maxLines?: number;
  textOverflow?: "ellipsis";
} {
  return options?.textOverflow === "truncate"
    ? { maxLines: 1, textOverflow: "ellipsis" }
    : {};
}

// react-pdf breaks a long word at the English hyphenation points it finds, so
// a part number could print split inside itself ("BAT-LI-" / "ION-48V"). A
// line title breaks between words, so "SW-1045 (P000123.B)" wraps at the space
// before the bracket. A word longer than ITEM_WORD_CHUNK (which fits the
// narrowest title column, the purchase order's, about 112pt at 9pt) breaks
// after its own separators: an empty piece is a break at which textkit draws
// nothing, where a break between two pieces draws a hyphen that would read as
// part of the number. Only a run of more than ITEM_WORD_CHUNK characters with
// no separator breaks inside itself, with that hyphen.
const ITEM_WORD_CHUNK = 16;

/** The `hyphenationCallback` for a line-item title. */
export function breakLongItemWord(word: string): string[] {
  if (word.length <= ITEM_WORD_CHUNK) return [word];
  return word
    .split(/(?<=[-/_.])/)
    .flatMap((segment, index) => [
      ...(index > 0 ? [""] : []),
      ...chunkWord(segment, ITEM_WORD_CHUNK)
    ]);
}
