// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { LineItemsOptions } from "../../template";

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
// before the bracket. A word longer than ITEM_WORD_CHUNK breaks every
// ITEM_WORD_CHUNK characters instead, which fits the narrowest title column
// (the purchase order's, about 112pt at 9pt).
const ITEM_WORD_CHUNK = 16;

/** The `hyphenationCallback` for a line-item title. */
export function breakLongItemWord(word: string): string[] {
  if (word.length <= ITEM_WORD_CHUNK) return [word];
  const parts: string[] = [];
  for (let start = 0; start < word.length; start += ITEM_WORD_CHUNK) {
    parts.push(word.slice(start, start + ITEM_WORD_CHUNK));
  }
  return parts;
}
