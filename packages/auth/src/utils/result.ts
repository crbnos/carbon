import { getLogger } from "@carbon/logger";
import type { Result } from "../types";

const log = getLogger("auth");

export function error(error: any, message = "Request failed"): Result {
  if (error) log.error(message, { error });

  return {
    success: false,
    message: message
  };
}

export function success(message = "Request succeeded", data?: any): Result {
  return {
    success: true,
    message
  };
}
