// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SERVICE_RULE_ERROR_CODE } from "@carbon/api";

export { SERVICE_RULE_ERROR_CODE } from "@carbon/api";
export { parseJobFilePath } from "@carbon/files/media";
export { sanitize } from "@carbon/utils";

export function ruleError(message: string) {
  return { code: SERVICE_RULE_ERROR_CODE, message };
}
