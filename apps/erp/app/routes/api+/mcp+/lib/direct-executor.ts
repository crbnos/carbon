// Direct executor for ERP functions without MCP protocol wrapper

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as accountFunctions from "~/modules/account/account.service";
import * as accountingFunctions from "~/modules/accounting/accounting.service";
import * as documentsFunctions from "~/modules/documents/documents.service";
import * as inventoryFunctions from "~/modules/inventory/inventory.service";
import * as invoicingFunctions from "~/modules/invoicing/invoicing.service";
import * as itemsFunctions from "~/modules/items/items.service";
import * as peopleFunctions from "~/modules/people/people.service";
import * as productionFunctions from "~/modules/production/production.service";
import * as purchasingFunctions from "~/modules/purchasing/purchasing.service";
import * as qualityFunctions from "~/modules/quality/quality.service";
import * as resourcesFunctions from "~/modules/resources/resources.service";
import * as salesFunctions from "~/modules/sales/sales.service";
import * as settingsFunctions from "~/modules/settings/settings.service";
import * as sharedFunctions from "~/modules/shared/shared.service";
import * as usersFunctions from "~/modules/users/users.service";
import { isMcpBlockedTool } from "./mcp-blocked-tools";
import toolMetadata from "./tool-metadata.json";

// Combine all functions into a single registry
const functionRegistry = {
  account: accountFunctions,
  accounting: accountingFunctions,
  documents: documentsFunctions,
  inventory: inventoryFunctions,
  invoicing: invoicingFunctions,
  items: itemsFunctions,
  people: peopleFunctions,
  production: productionFunctions,
  purchasing: purchasingFunctions,
  quality: qualityFunctions,
  resources: resourcesFunctions,
  sales: salesFunctions,
  settings: settingsFunctions,
  shared: sharedFunctions,
  users: usersFunctions
};

export interface ExecutorContext {
  client: SupabaseClient<Database>;
  companyId: string;
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
  const normalizedArgs = args && typeof args === "object" ? args : undefined;

  if (isMcpBlockedTool(functionName)) {
    return {
      success: false,
      error: `Tool disabled: ${functionName} is not available via MCP.`
    };
  }

  // Parse the function name to get module and function
  const parts = functionName.split("_");
  if (parts.length < 2) {
    console.error(
      "[DirectExecutor] Invalid function name format:",
      functionName
    );
    throw new Error(`Invalid function name format: ${functionName}`);
  }

  const moduleName = parts[0];
  const funcName = parts.slice(1).join("_");

  // Get the module functions
  const moduleFunctions =
    functionRegistry[moduleName as keyof typeof functionRegistry];
  if (!moduleFunctions) {
    console.error("[DirectExecutor] Module not found:", moduleName);
    throw new Error(`Module not found: ${moduleName}`);
  }

  // Get the specific function
  const func = moduleFunctions[funcName as keyof typeof moduleFunctions];
  if (!func || typeof func !== "function") {
    console.error(
      "[DirectExecutor] Function not found:",
      funcName,
      "in module",
      moduleName
    );
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

    // Build arguments array based on parameter names
    const functionArgs: any[] = [];

    for (const paramName of paramNames) {
      if (paramName === "client") {
        functionArgs.push(context.client);
      } else if (paramName === "userId") {
        const userIdValue = normalizedArgs?.userId || context.userId;
        functionArgs.push(userIdValue);
      } else if (paramName === "companyId") {
        const companyIdValue = normalizedArgs?.companyId || context.companyId;
        functionArgs.push(companyIdValue);
      } else if (paramName === "args") {
        // For 'args' parameter, pass the entire args object or a default
        // This is the parameter that most service functions expect
        const argsValue = normalizedArgs || {};
        functionArgs.push(argsValue);
      } else if (normalizedArgs && paramName in normalizedArgs) {
        functionArgs.push(normalizedArgs[paramName]);
      } else if (
        normalizedArgs &&
        Object.keys(normalizedArgs).length === 1 &&
        !paramNames.some((p: string) => p in normalizedArgs)
      ) {
        // If single arg that doesn't match param names, use it as positional
        const value = Object.values(normalizedArgs)[0];
        functionArgs.push(value);
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
        console.error("[DirectExecutor] Query execution failed:", queryError);
        throw queryError;
      }
    }

    return {
      success: true,
      data: result
    };
  } catch (error: any) {
    console.error("[DirectExecutor] Function execution failed:", error);
    console.error("[DirectExecutor] Error stack:", error.stack);
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
