// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Rows per cursor page (infinite scroll). Below PostgREST's max_rows of 1000.
export const PAGE_SIZE = 100;

// Rows a single-load list (one that cannot page: a tree, a list with no unique
// id, a sort on a joined table) reads at once, by offset: `.range(0, 999)`.
// It is PostgREST's max_rows, so a list that gets exactly this many may have
// more, and its table says so (`<Table isTruncated>`).
export const SINGLE_LOAD_LIMIT = 1000;
