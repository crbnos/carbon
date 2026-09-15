import { getLogger } from "@carbon/logger";
import type { AuthedContext } from "~/routes/api+/v1+/lib/base.server";

const logger = getLogger("erp", "mcp");

/** MCP runs as the same identity every Carbon API call runs as. Type-only alias —
 *  erased at runtime, so no server module enters a client graph through here. */
export type McpContext = AuthedContext;

export const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

export const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

export const DESTRUCTIVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
} as const;

export function withErrorHandling<T extends Record<string, unknown>>(
  handler: (params: T) => Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }>,
  fallbackMessage: string
) {
  return async (params: T) => {
    try {
      // No info logging here — each handler logs its own invocation/result;
      // this wrapper only reports the throw path.
      return await handler(params);
    } catch (error) {
      logger.error("Error in handler", {
        fallbackMessage,
        error,
        stack: error instanceof Error ? error.stack : "No stack"
      });
      return {
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : fallbackMessage
          }
        ],
        isError: true
      };
    }
  };
}
