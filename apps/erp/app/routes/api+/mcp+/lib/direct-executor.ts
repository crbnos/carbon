// Direct executor for ERP functions without MCP protocol wrapper

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  dedupeViolations,
  evaluateSalesRuleLines,
  evaluateSalesRulesForSalesDocument,
  resolveSalesOrderShipTo,
  type SalesDocumentType
} from "@carbon/ee/rules.server";
import { getLogger } from "@carbon/logger";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as accountFunctions from "~/modules/account/account.service";
import * as accountingFunctions from "~/modules/accounting/accounting.ee.service";
import * as documentsFunctions from "~/modules/documents/documents.service";
import * as inventoryFunctions from "~/modules/inventory/inventory.service";
import * as invoicingFunctions from "~/modules/invoicing/invoicing.service";
import * as itemsFunctions from "~/modules/items/items.service";
import * as peopleFunctions from "~/modules/people/people.service";
import * as productionMcpFunctions from "~/modules/production/production.mcp.server";
import * as productionFunctions from "~/modules/production/production.service";
import * as purchasingFunctions from "~/modules/purchasing/purchasing.service";
import * as qualityFunctions from "~/modules/quality/quality.service";
import * as resourcesFunctions from "~/modules/resources/resources.service";
import { recordSalesRuleOutcome } from "~/modules/sales/sales.server";
import * as salesFunctions from "~/modules/sales/sales.service";
import * as settingsFunctions from "~/modules/settings/settings.service";
import * as sharedFunctions from "~/modules/shared/shared.service";
import * as usersFunctions from "~/modules/users/users.service";
import { getDatabaseClient } from "~/services/database.server";
import { isMcpBlockedTool } from "./mcp-blocked-tools";
import toolMetadata from "./tool-metadata.json";
import type { AuthField } from "./types";

const logger = getLogger("erp", "mcp", "direct-executor");

// Combine all functions into a single registry
const functionRegistry = {
  account: accountFunctions,
  accounting: accountingFunctions,
  documents: documentsFunctions,
  inventory: inventoryFunctions,
  invoicing: invoicingFunctions,
  items: itemsFunctions,
  people: peopleFunctions,
  production: { ...productionFunctions, ...productionMcpFunctions },
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
  companyGroupId: string;
  userId: string;
}

export type McpOperation = "create" | "update";

// Stamps auth identity onto typed payloads. Carbon's services expect auth
// fields inside the payload (predates MCP). `fields` is per-tool from
// tool-metadata.json so reads stay clean and updates don't overwrite createdBy.
function enrichWithAuthContext(
  value: unknown,
  context: ExecutorContext,
  fields: AuthField[],
  operation?: McpOperation
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  if (fields.length === 0) return value;

  const enriched: Record<string, unknown> = {
    ...(value as Record<string, unknown>)
  };

  // A caller-supplied createdBy would send the service down its insert branch.
  if (operation === "update") {
    delete enriched.createdBy;
  } else if (fields.includes("createdBy") && !("createdBy" in enriched)) {
    enriched.createdBy = context.userId;
  }
  if (fields.includes("updatedBy")) {
    enriched.updatedBy = context.userId;
  }
  if (fields.includes("companyId")) {
    enriched.companyId = context.companyId;
  }
  if (fields.includes("companyGroupId")) {
    enriched.companyGroupId = context.companyGroupId;
  }

  return enriched;
}

/**
 * Sales-rule backstop for sales line writes reached through MCP.
 *
 * The route actions that add quote / sales-order / sales-invoice lines
 * evaluate sales rules before writing. This executor calls the same service
 * functions by name, so those checks never run — an agent holding an OAuth
 * token or API key could otherwise put a restricted item on a sales document.
 *
 * The check lives here rather than inside `upsertQuoteLine` /
 * `upsertSalesOrderLine` / `upsertSalesInvoiceLine` deliberately: the service
 * files are re-exported from module barrels that UI components import, so they
 * must stay free of server-only imports. This module is server-only by
 * construction.
 *
 * Only `error`-severity violations block. A `warn` needs a human to acknowledge
 * it, and there is no human on this path — warns are allowed through so the
 * agent isn't wedged on a rule a person could have waved past.
 */
async function checkSalesRulesForSalesLineWrite(
  functionName: string,
  context: ExecutorContext,
  args?: Record<string, any>
): Promise<{ success: false; error: string } | null> {
  const surface =
    functionName === "sales_upsertQuoteLine"
      ? ("quoteLine" as const)
      : functionName === "sales_upsertSalesOrderLine"
        ? ("salesOrderLine" as const)
        : functionName === "invoicing_upsertSalesInvoiceLine"
          ? ("salesInvoiceLine" as const)
          : null;
  if (!surface || !args) return null;

  // The invoicing tool's payload arrives nested under its parameter name
  // (`serviceParams: ["client", "salesInvoiceLine"]`); the sales tools' args
  // are flat.
  const payload: Record<string, any> =
    surface === "salesInvoiceLine" &&
    args.salesInvoiceLine &&
    typeof args.salesInvoiceLine === "object"
      ? args.salesInvoiceLine
      : args;

  const itemId = typeof payload.itemId === "string" ? payload.itemId : null;
  if (!itemId) return null;

  const documentId =
    surface === "quoteLine"
      ? typeof payload.quoteId === "string"
        ? payload.quoteId
        : null
      : surface === "salesOrderLine"
        ? typeof payload.salesOrderId === "string"
          ? payload.salesOrderId
          : null
        : typeof payload.invoiceId === "string"
          ? payload.invoiceId
          : null;
  if (!documentId) return null;

  const serviceRole = getCarbonServiceRole();
  const lineId = typeof payload.id === "string" ? payload.id : "new";
  const shipTo =
    surface === "salesOrderLine"
      ? await resolveSalesOrderShipTo(
          serviceRole,
          documentId,
          context.companyId
        )
      : surface === "salesInvoiceLine"
        ? await (async () => {
            // An invoice line converted from a sales order resolves its
            // ship-to through that order; a standalone line has none and
            // none may be invented (the bill-to is a different address), so
            // a null location lets a destination rule fail closed via the
            // engine's required-field semantics.
            if (lineId !== "new") {
              const existing = await serviceRole
                .from("salesInvoiceLine")
                .select("salesOrderId")
                .eq("id", lineId)
                .eq("companyId", context.companyId)
                .maybeSingle();
              if (existing.data?.salesOrderId) {
                return resolveSalesOrderShipTo(
                  serviceRole,
                  existing.data.salesOrderId,
                  context.companyId
                );
              }
            }
            const { data } = await serviceRole
              .from("salesInvoice")
              .select("customerId")
              .eq("id", documentId)
              .eq("companyId", context.companyId)
              .maybeSingle();
            return {
              customerId: data?.customerId ?? null,
              customerLocationId: null
            };
          })()
        : await (async () => {
            const { data } = await serviceRole
              .from("quote")
              .select("customerId, customerLocationId")
              .eq("id", documentId)
              .eq("companyId", context.companyId)
              .maybeSingle();
            return {
              customerId: data?.customerId ?? null,
              customerLocationId: data?.customerLocationId ?? null
            };
          })();

  const quantity =
    typeof payload.saleQuantity === "number"
      ? payload.saleQuantity
      : Array.isArray(payload.quantity)
        ? Math.max(1, ...(payload.quantity as number[]))
        : typeof payload.quantity === "number"
          ? payload.quantity
          : 1;

  const { violations, ruleNames } = await evaluateSalesRuleLines({
    client: serviceRole,
    companyId: context.companyId,
    userId: context.userId,
    surface,
    lines: [
      {
        lineId,
        itemId,
        quantity
      }
    ],
    customerId: shipTo.customerId,
    customerLocationId: shipTo.customerLocationId
  });

  const errors = dedupeViolations(violations).filter(
    (v) => v.severity === "error"
  );
  if (errors.length === 0) return null;

  // Blocked evidence, same as the human line routes. Warns that passed leave
  // no row on purpose: "acknowledged" means a person waved them past, and no
  // person did here.
  await recordSalesRuleOutcome(serviceRole, {
    companyId: context.companyId,
    userId: context.userId,
    documentType:
      surface === "quoteLine"
        ? "quote"
        : surface === "salesOrderLine"
          ? "salesOrder"
          : "salesInvoice",
    documentId,
    documentLineId: lineId === "new" ? null : lineId,
    itemId,
    outcome: "blocked",
    violations: errors,
    ruleNames
  });

  return {
    success: false,
    error: `Blocked by sales rules: ${errors.map((v) => v.message).join("; ")}`
  };
}

/**
 * Sales-rule backstop for the terminal sales-document transitions reached
 * through MCP. The route actions run `evaluateSalesRulesForSalesDocument`
 * before finalizing a quote, converting a quote to an order, or converting an
 * RFQ to a quote — but this executor calls the same service functions by name,
 * so without this gate an agent could finalize or convert a document carrying
 * error-severity violations that every human path blocks.
 *
 * Same block semantics as the line-write backstop above: only `error`
 * violations block; there is no human on this path to acknowledge a `warn`.
 */
async function checkSalesRulesForSalesDocumentTransition(
  functionName: string,
  context: ExecutorContext,
  args?: Record<string, any>
): Promise<{ success: false; error: string } | null> {
  const documentType: SalesDocumentType | null =
    functionName === "sales_finalizeQuote" ||
    functionName === "sales_convertQuoteToOrder"
      ? "quote"
      : functionName === "sales_convertSalesRfqToQuote"
        ? "salesRfq"
        : null;
  if (!documentType || !args) return null;

  // `finalizeQuote` takes flat args (`quoteId`); the two convert functions
  // take a nested `payload` (`serviceParams: ["client", "payload"]`) whose
  // document id is `id`. Accept both shapes so a flat-args call is still
  // gated.
  const payload: Record<string, any> =
    args.payload && typeof args.payload === "object" ? args.payload : args;
  const documentId =
    typeof payload.quoteId === "string"
      ? payload.quoteId
      : typeof payload.id === "string"
        ? payload.id
        : null;
  if (!documentId) return null;

  const serviceRole = getCarbonServiceRole();
  const { violations, ruleNames } = await evaluateSalesRulesForSalesDocument({
    client: serviceRole,
    companyId: context.companyId,
    userId: context.userId,
    documentType,
    documentId
  });

  const errors = dedupeViolations(violations).filter(
    (v) => v.severity === "error"
  );
  if (errors.length === 0) return null;

  // Blocked evidence, same as the route gates. An RFQ has no evidence row
  // (the acknowledgment table's documentType CHECK covers quote / salesOrder /
  // salesInvoice only); its lines are re-gated at the quote stage.
  if (documentType === "quote") {
    await recordSalesRuleOutcome(serviceRole, {
      companyId: context.companyId,
      userId: context.userId,
      documentType: "quote",
      documentId,
      outcome: "blocked",
      violations: errors,
      ruleNames
    });
  }

  return {
    success: false,
    error: `Blocked by sales rules: ${errors.map((v) => v.message).join("; ")}`
  };
}

// Pulls the MCP-only `_operation` flag out of the args, top level or nested.
// Returns every value it found so the caller can reject contradictory ones.
function extractOperation(args: Record<string, any> | undefined): {
  operations: string[];
  args: Record<string, any> | undefined;
} {
  if (!args) return { operations: [], args };

  const operations: string[] = [];
  const cleaned: Record<string, any> = {};

  if (args._operation !== undefined) operations.push(String(args._operation));

  for (const [key, value] of Object.entries(args)) {
    if (key === "_operation") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const { _operation, ...rest } = value as Record<string, any>;
      if (_operation !== undefined) {
        operations.push(String(_operation));
        cleaned[key] = rest;
        continue;
      }
    }
    cleaned[key] = value;
  }

  return { operations, args: cleaned };
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

  const salesRuleBlock = await checkSalesRulesForSalesLineWrite(
    functionName,
    context,
    normalizedArgs
  );
  if (salesRuleBlock) return salesRuleBlock;

  const salesDocumentBlock = await checkSalesRulesForSalesDocumentTransition(
    functionName,
    context,
    normalizedArgs
  );
  if (salesDocumentBlock) return salesDocumentBlock;

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
