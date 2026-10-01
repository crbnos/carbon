// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export { parseJobFilePath } from "@carbon/files/media";
export { sanitize } from "@carbon/utils";

/**
 * The code on an error a service writes itself: a refused business rule, not
 * a database failure. API and MCP callers see its message as written, while a
 * database failure is reduced to a fixed public message.
 */
export const SERVICE_RULE_ERROR_CODE = "CARBON_RULE";

export function ruleError(message: string) {
  return { code: SERVICE_RULE_ERROR_CODE, message };
}
