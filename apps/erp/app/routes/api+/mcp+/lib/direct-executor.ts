// Route-side adapter for the MCP tool executor. Keeps the legacy
// `{success, data, error}` shape that `server.ts` and any external callers
// already consume; the real work lives in `~/services/mcp/executor`.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ExecutorAuthorize,
  type ExecutorResult,
  ToolExecutor
} from "~/services/mcp";

export interface ExecutorContext {
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
}

export type LegacyExecutorResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

// Centralized authorization chokepoint for MCP-invoked tools. Today this is
// observe-only (every classification is logged and allowed) so RLS at the DB
// remains the real gate, but the hook exists so role/permission checks can be
// added in one place without touching the executor or per-tool wiring.
const authorize: ExecutorAuthorize = (classification, toolId, _context) => {
  if (classification === "DESTRUCTIVE") {
    console.log(`[mcp] DESTRUCTIVE tool invoked: ${toolId}`);
  }
  return null;
};

const executor = new ToolExecutor(undefined, undefined, authorize);

export async function executeFunction(
  functionName: string,
  context: ExecutorContext,
  args?: Record<string, unknown> | string
): Promise<LegacyExecutorResult> {
  const result = await executor.execute(functionName, context, args);
  return toLegacyResult(result);
}

function toLegacyResult(result: ExecutorResult): LegacyExecutorResult {
  if (result.ok) return { success: true, data: result.data };
  return { success: false, error: result.message };
}
