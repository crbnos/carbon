// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
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
