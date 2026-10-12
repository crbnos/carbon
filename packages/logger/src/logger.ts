// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger as getLogTapeLogger, type Logger } from "@logtape/logtape";

/** Root category — every Carbon log sits under this prefix. */
export const CARBON_ROOT_CATEGORY = "carbon";

/**
 * Get a logger scoped to a Carbon category.
 *
 * @example
 * getLogger("auth")          // ["carbon","auth"]
 * getLogger("erp", "sales")  // ["carbon","erp","sales"]
 * getLogger("jobs", fnName)  // ["carbon","jobs",fnName]
 */
export function getLogger(...category: string[]): Logger {
  return getLogTapeLogger([CARBON_ROOT_CATEGORY, ...category]);
}
