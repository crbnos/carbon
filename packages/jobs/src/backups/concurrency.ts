// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** Tables the backup jobs read or write at once: each holds a connection of
 *  the job process's shared pool (16) while it runs. */
export const TABLE_CONCURRENCY = 6;
