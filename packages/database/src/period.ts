// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * The transaction advisory lock every writer of `period` rows takes before it
 * reads the weeks it may insert. `period` is shared by every company and has
 * no unique key on a week, so the planning screens, MRP and the dataset seeder
 * must all take this one key, or two of them insert the same week.
 */
export const PERIOD_LOCK_KEY = 4820260813;
