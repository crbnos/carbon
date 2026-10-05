// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Which of the four operations views a screen is: web MES's four OPERATIONS
 * sidebar items.
 *
 * These were reached through a segmented control at the top of one Schedule
 * tab, because the bottom bar was full at five. They are now what web makes
 * them — four navigation destinations — so the control is gone and this is
 * all that remains of it: the name a screen passes to say which queue it is
 * showing.
 */
export type QueueView = "board" | "assigned" | "active" | "recent";
