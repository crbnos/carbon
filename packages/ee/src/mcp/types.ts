import type { ManifestEntry } from "@carbon/api";
import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogSearch } from "./catalog-search";

const logger = getLogger("erp", "mcp");

/** The minimum an MCP request context must carry for the engine — the caller
 *  (the app route) passes its full `AuthedContext`, which is a superset. The
 *  engine is generic over the concrete context (see `createMcpServer`), so the
 *  app's dispatch (`deps.callOperation`) receives the real context unchanged;
 *  the engine itself only reads `client`/`companyId` (for the entitlement gate). */
export type McpContext = {
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  userId: string;
};

/** The result shape the app's `callOperation` returns, redeclared here so the
 *  engine need not import app code. */
export type McpCallResult =
  | { success: true; data?: unknown; count?: number }
  | { success: false; error: string; errorKind?: string };

/** Everything the MCP engine needs from the APP side, injected by the route.
 *  The dispatch (`callOperation`), its manifest (`operationsByName` /
 *  `isListOperation`), the blocked-tool predicate and the generated tool
 *  metadata all derive from `apps/erp`'s `~/modules/*` and cannot move into a
 *  package — so they are passed in rather than imported. */
export interface McpServerDeps<Ctx> {
  callOperation: (
    name: string,
    ctx: Ctx,
    args?: string | Record<string, unknown>
  ) => Promise<McpCallResult>;
  operationsByName: Map<string, ManifestEntry>;
  isListOperation: (meta: ManifestEntry) => boolean;
  isMcpBlockedTool: (name: string) => boolean;
  /** Built once at module scope by the route from `tool-metadata.json`. */
  catalogSearch: CatalogSearch;
  /** The generated catalog summary the instructions + search footer read. */
  toolMetadata: {
    tools: Pick<ManifestEntry, "module">[];
    totalTools: number;
    modules: number;
  };
}

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
