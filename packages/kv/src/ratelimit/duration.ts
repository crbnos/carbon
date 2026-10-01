// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Duration } from "./types";

/**
 * Convert a human-readable duration string to milliseconds
 * Matches @upstash/ratelimit duration parsing
 *
 * @example
 * ms("10 s") // 10000
 * ms("1m")   // 60000
 * ms("1 h")  // 3600000
 */
export function ms(d: Duration): number {
  const match = d.match(/^(\d+)\s?(ms|s|m|h|d)$/);
  if (!match) {
    throw new Error(`Unable to parse window size: ${d}`);
  }

  const time = Number.parseInt(match[1]!);
  const unit = match[2] as "ms" | "s" | "m" | "h" | "d";

  switch (unit) {
    case "ms":
      return time;
    case "s":
      return time * 1000;
    case "m":
      return time * 1000 * 60;
    case "h":
      return time * 1000 * 60 * 60;
    case "d":
      return time * 1000 * 60 * 60 * 24;
    default:
      throw new Error(`Unable to parse window size: ${d}`);
  }
}
