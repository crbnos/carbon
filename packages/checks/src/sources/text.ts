// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** The 1-based line that the character at `index` of `text` is on. */
export const lineOf = (text: string, index: number) =>
  text.slice(0, index).split("\n").length;

/** The first character of a JavaScript identifier, and any later one. */
export const IDENT_START = /[A-Za-z_$]/;
export const IDENT_PART = /[\w$]/;
