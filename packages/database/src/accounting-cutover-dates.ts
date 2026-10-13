// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The date rule of the accounting cutover
// (.ai/specs/implemented/2026-10-08-accounting-cutover.md section 6). Pure: callers read
// the company's `accountingCutoverDate` and the document's posting date.

import { parseDate } from "@internationalized/date";

/**
 * True when a document's posting date is before the company's cutover. A
 * company with no cutover has nothing before it, so every document keeps the
 * behavior it had before the cutover existed.
 */
export function isBeforeCutover(
  postingDate: string,
  cutoverDate: string | null
): boolean {
  if (!cutoverDate) return false;
  return parseDate(postingDate).compare(parseDate(cutoverDate)) < 0;
}
