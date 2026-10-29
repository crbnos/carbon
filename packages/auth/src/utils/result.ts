// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import type { Result } from "../types";

const log = getLogger("auth");

export function error(error: any, message = "Request failed"): Result {
  // The dev text formatter prints only the message template, never unreferenced
  // properties — so the cause must be a `{error}` placeholder or it is silently
  // dropped. Braces in the message are escaped so they aren't read as placeholders.
  if (error) {
    const template = message.replaceAll("{", "{{").replaceAll("}", "}}");
    log.error(`${template}: {error}`, { error });
  }

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
