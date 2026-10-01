// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import type { Result } from "../types";

const log = getLogger("auth");

export function error(error: any, message = "Request failed"): Result {
  if (error) log.error(message, { error });

  return {
    success: false,
    message
  };
}

export function success(message = "Request succeeded", data?: any): Result {
  return {
    success: true,
    message
  };
}
