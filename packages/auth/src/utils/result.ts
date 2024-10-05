import type { Result } from "../types";

export function error(error: any, message = "Request failed"): Result {
  if (error) console.error({ error, message });

  return {
    success: false,
    message: message,
  };
}

export function success(message = "Request succeeded", data?: any): Result {
  return {
    success: true,
    message,
  };
}
