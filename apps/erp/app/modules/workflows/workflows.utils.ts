// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * A batched node writes one row per item, so a 100-item batch alone is 100+ rows
 * each carrying input, output and detail JSONB. Cap what reaches the browser; the
 * caller reads one row past the cap to know it truncated.
 */
export const MAX_RUN_STEPS = 200;
