// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { describeCause } from "@carbon/utils";
import type { Result } from "../types";

const logger = getLogger("auth", "result");

/**
 * A failed result for the user, logged once here: `context` carries what the
 * log line needs beyond the request's own identity (the record it was about).
 */
export function error(
  error: any,
  message = "Request failed",
  context?: Record<string, unknown>
): Result {
  // The caller's message is the template, so its failures group as one error.
  // A brace in it is text, not a placeholder.
  if (error) {
    logger.error(message.replaceAll("{", "{{").replaceAll("}", "}}"), {
      ...context,
      error
    });
  }

  const reason = describeCause(error);
  return {
    success: false,
    message,
    ...(reason && { reason })
  };
}

export function success(message = "Request succeeded", data?: any): Result {
  return {
    success: true,
    message
  };
}
