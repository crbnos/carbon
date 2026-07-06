import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface McpContext {
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  userId: string;
}

export type AuthField =
  | "companyId"
  | "companyGroupId"
  | "createdBy"
  | "updatedBy";

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
      console.log(
        `[withErrorHandling] Executing handler for: ${fallbackMessage}`
      );
      const result = await handler(params);
      console.log(`[withErrorHandling] Handler completed successfully`);
      return result;
    } catch (error) {
      console.error(
        `[withErrorHandling] Error in handler (${fallbackMessage}):`,
        error
      );
      console.error(
        `[withErrorHandling] Error stack:`,
        error instanceof Error ? error.stack : "No stack"
      );
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
