// Direct executor for ERP functions without MCP protocol wrapper.
//
// TRANSITIONAL: the registry and the enrichment/extraction helpers now live in the
// oRPC layer (`api+/v1+/lib/{registry,dispatch}.server.ts`) — this file re-imports
// them so exactly one copy exists while its remaining callers migrate to
// `callOperation`. It is deleted once the workflow dispatcher moves over.

import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDatabaseClient } from "~/services/database.server";
import {
  enrichWithAuthContext,
  extractOperation,
  type McpOperation
} from "../../v1+/lib/dispatch.server";
import { functionRegistry } from "../../v1+/lib/registry.server";
import { isMcpBlockedTool } from "./mcp-blocked-tools";
import toolMetadata from "./tool-metadata.json";
import type { AuthField } from "./types";

const logger = getLogger("erp", "mcp", "direct-executor");

export { enrichWithAuthContext, extractOperation, functionRegistry };
export type { McpOperation };

export interface ExecutorContext {
  client: SupabaseClient<Database>;
  companyId: string;
  companyGroupId: string;
  userId: string;
}

export async function executeFunction(
  functionName: string,
  context: ExecutorContext,
  args?: Record<string, any> | string
) {
  if (typeof args === "string") {
    try {
      args = args.trim().length > 0 ? JSON.parse(args) : {};
    } catch {
      return {
        success: false,
        error: "Invalid JSON arguments"
      };
    }
  }
  const rawArgs = args && typeof args === "object" ? args : undefined;

  // Strip before use — the branches below hand args straight to the service.
  const { operations: requestedOperations, args: normalizedArgs } =
    extractOperation(rawArgs);

  if (isMcpBlockedTool(functionName)) {
    return {
      success: false,
      error: `Tool disabled: ${functionName} is not available via MCP.`
    };
  }

  // Parse the function name to get module and function
  const parts = functionName.split("_");
  if (parts.length < 2) {
    logger.error("Invalid function name format", { functionName });
    throw new Error(`Invalid function name format: ${functionName}`);
  }

  const moduleName = parts[0];
  const funcName = parts.slice(1).join("_");

  // Get the module functions
  const moduleFunctions =
    functionRegistry[moduleName as keyof typeof functionRegistry];
  if (!moduleFunctions) {
    logger.error("Module not found", { moduleName });
    throw new Error(`Module not found: ${moduleName}`);
  }

  // Get the specific function
  const func = moduleFunctions[funcName as keyof typeof moduleFunctions];
  if (!func || typeof func !== "function") {
    logger.error("Function not found", { funcName, moduleName });
    throw new Error(`Function not found: ${funcName} in module ${moduleName}`);
  }

  try {
    const toolMeta = toolMetadata.tools.find(
      (t: { name: string }) => t.name === functionName
    );
    const paramNames: string[] =
      toolMeta && "serviceParams" in toolMeta
        ? (toolMeta as any).serviceParams
        : [];
    const injectAuth: AuthField[] =
      toolMeta && "injectAuth" in toolMeta
        ? ((toolMeta as any).injectAuth as AuthField[])
        : [];
    const needsOperation = Boolean(
      (toolMeta as any)?.schema?.properties?._operation
    );

    const distinctOperations = [...new Set(requestedOperations)];
    if (needsOperation && distinctOperations.length > 1) {
      return {
        success: false,
        error: `${functionName} received conflicting _operation values (${distinctOperations.join(", ")}).`
      };
    }
    const requestedOperation = distinctOperations[0];
    if (
      needsOperation &&
      requestedOperation !== "create" &&
      requestedOperation !== "update"
    ) {
      return {
        success: false,
        error: `${functionName} requires _operation to be "create" (insert a new record) or "update" (modify an existing one).`
      };
    }
    const operation = needsOperation
      ? (requestedOperation as McpOperation)
      : undefined;

    // Build arguments array based on parameter names
    const functionArgs: any[] = [];

    for (const paramName of paramNames) {
      if (paramName === "client") {
        functionArgs.push(context.client);
      } else if (paramName === "db") {
        functionArgs.push(getDatabaseClient());
      } else if (paramName === "userId") {
        functionArgs.push(context.userId);
      } else if (paramName === "companyId") {
        functionArgs.push(context.companyId);
      } else if (paramName === "companyGroupId") {
        functionArgs.push(context.companyGroupId);
      } else if (paramName === "args") {
        // For 'args' parameter, pass the entire args object or a default
        // This is the parameter that most service functions expect
        const argsValue = normalizedArgs || {};
        functionArgs.push(argsValue);
      } else if (normalizedArgs && paramName in normalizedArgs) {
        functionArgs.push(
          enrichWithAuthContext(
            normalizedArgs[paramName],
            context,
            injectAuth,
            operation
          )
        );
      } else if (
        normalizedArgs &&
        Object.keys(normalizedArgs).length === 1 &&
        !paramNames.some((p: string) => p in normalizedArgs) &&
        typeof Object.values(normalizedArgs)[0] === "object" &&
        Object.values(normalizedArgs)[0] !== null
      ) {
        // Single-key payload whose name doesn't match any parameter — unwrap
        // and use as positional. Hits the documented `{ args: {...} }` wrapper
        // and any LLM that guesses a key name (e.g. `{ item: {...} }`).
        const value = Object.values(normalizedArgs)[0];
        functionArgs.push(
          enrichWithAuthContext(value, context, injectAuth, operation)
        );
      } else if (normalizedArgs && Object.keys(normalizedArgs).length > 0) {
        // No key matched — pass the entire args object as a positional param.
        // Handles functions like upsertPart(client, part) where the caller
        // passes flat fields instead of nesting under the param name.
        functionArgs.push(
          enrichWithAuthContext(
            { ...normalizedArgs },
            context,
            injectAuth,
            operation
          )
        );
      } else {
        // Skip optional parameters
        continue;
      }
    }

    // Execute the function
    let result = await (func as Function)(...functionArgs);

    // Check if result is a Supabase query builder (it's thenable but not yet executed)
    // Supabase queries are thenable objects that need to be awaited
    if (
      result &&
      typeof result === "object" &&
      typeof result.then === "function"
    ) {
      try {
        const executedResult = await result;
        result = executedResult;
      } catch (queryError: any) {
        logger.error("Query execution failed", { error: queryError });
        throw queryError;
      }
    }

    return {
      success: true,
      data: result
    };
  } catch (error: any) {
    logger.error("Function execution failed", { error, stack: error.stack });
    return {
      success: false,
      error: error.message || "Function execution failed"
    };
  }
}

// Helper to search available functions
export function searchFunctions(query?: string, module?: string): string[] {
  const results: string[] = [];

  Object.entries(functionRegistry).forEach(([moduleName, functions]) => {
    if (module && moduleName !== module) return;

    Object.keys(functions).forEach((funcName) => {
      const fullName = `${moduleName}_${funcName}`;
      if (isMcpBlockedTool(fullName)) return;
      if (!query || fullName.toLowerCase().includes(query.toLowerCase())) {
        results.push(fullName);
      }
    });
  });

  return results;
}
