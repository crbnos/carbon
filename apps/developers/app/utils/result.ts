import logger from "~/lib/logger";
import type { Result } from "~/types";

export function error(error: any, message = "Request failed"): Result {
  if (error) logger.error({ error, message });

  // Removed details because it can grow too large (larger than the cookie limit)
  // const details =
  //   typeof error === "object" && error !== null && "message" in error
  //     ? (error.message as string)
  //     : undefined;

  return {
    success: false,
    message: message,
  };
}

export function success(message = "Request succeeded"): Result {
  return {
    success: true,
    message,
  };
}
