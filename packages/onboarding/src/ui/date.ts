// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type CalendarDate, parseDate } from "@internationalized/date";

// Stored field values are `YYYY-MM-DD`; the Carbon DatePicker speaks CalendarDate.
// Returns undefined for empty/malformed input so the picker shows no selection.
export function toCalendarDate(
  value: string | undefined
): CalendarDate | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  try {
    return parseDate(value);
  } catch {
    return undefined;
  }
}
