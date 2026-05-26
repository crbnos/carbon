// Direct executor for ERP functions. Resolves a tool name (`module_name`) to
// a service function via a static-import map, builds positional args from
// the caller payload using metadata from `mcp-tools.json`, and runs the
// function inside an AuthContextHolder + AuthClientScope so service code
// that pulls identity/client from ALS sees the right values.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as accountFunctions from "~/modules/account/account.service.server";
import * as accountingFunctions from "~/modules/accounting/accounting.service.server";
import * as documentsFunctions from "~/modules/documents/documents.service.server";
import * as inventoryFunctions from "~/modules/inventory/inventory.service.server";
import * as invoicingFunctions from "~/modules/invoicing/invoicing.service.server";
import * as itemsFunctions from "~/modules/items/items.service.server";
import * as peopleFunctions from "~/modules/people/people.service.server";
import * as productionFunctions from "~/modules/production/production.service.server";
import * as purchasingFunctions from "~/modules/purchasing/purchasing.service.server";
import * as qualityFunctions from "~/modules/quality/quality.service.server";
import * as resourcesFunctions from "~/modules/resources/resources.service.server";
import * as salesFunctions from "~/modules/sales/sales.service.server";
import * as settingsFunctions from "~/modules/settings/settings.service.server";
import * as sharedFunctions from "~/modules/shared/shared.service.server";
import * as usersFunctions from "~/modules/users/users.service.server";
import {
  AuthClientScope,
  AuthContextHolder
} from "~/services/mcp/auth-context.server";
import { BLOCKED_TOOL_IDS } from "~/services/mcp/blocked";
import toolMetadata from "~/services/mcp/mcp-tools.json";
import type { AuthField } from "./types";

// -----------------------------------------------------------------------------
// Public types

export interface ExecutorContext {
  client: SupabaseClient<Database>;
  companyId: string;
  userId: string;
  sessionUserId?: string;
  email?: string;
  companyGroupId?: string;
}

export type LegacyExecutorResult =
  | { success: true; data: unknown }
  | { success: false; error: string };

// -----------------------------------------------------------------------------
// Static module map (closed set: every ERP service module is imported once at
// startup). New modules require adding an entry here and in
// scripts/generate-mcp-manifest.ts:SERVICE_MODULES.

const FUNCTION_REGISTRY = {
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
} as const;

type ModuleName = keyof typeof FUNCTION_REGISTRY;

// -----------------------------------------------------------------------------
// Tool metadata lookup

interface ToolMeta {
  id: string;
  module: string;
  name: string;
  classification: string;
  serviceParams: string[];
  injectAuth: AuthField[];
  injectInto?: string;
  disable: boolean;
}

type ToolCallable = (...args: unknown[]) => unknown;

const TOOLS_BY_NAME: ReadonlyMap<string, ToolMeta> = new Map(
  (toolMetadata.tools as ToolMeta[]).map((t) => [t.id, t])
);

// -----------------------------------------------------------------------------
// Public entry point

export async function executeFunction(
  functionName: string,
  context: ExecutorContext,
  rawArgs?: Record<string, unknown> | string
): Promise<LegacyExecutorResult> {
  if (BLOCKED_TOOL_IDS.has(functionName)) {
    return failure(`Tool disabled: ${functionName} is not available via MCP.`);
  }

  const parsed = normalizeArgs(rawArgs);
  if (!parsed.ok) return parsed.result;

  const resolved = resolveTool(functionName);
  if (!resolved.ok) return resolved.result;
  const { tool, fn } = resolved.value;

  const argsResult = buildPositionalArgs(tool, parsed.value, context);
  if (!argsResult.ok) return argsResult.result;

  return invokeWithinAuthScope(fn, argsResult.value, context);
}

// -----------------------------------------------------------------------------
// Step 1: argument normalization

type StepResult<T> =
  | { ok: true; value: T }
  | { ok: false; result: LegacyExecutorResult };

function normalizeArgs(
  raw: Record<string, unknown> | string | undefined
): StepResult<Record<string, unknown> | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return { ok: true, value: undefined };
    try {
      const parsed = JSON.parse(trimmed);
      return {
        ok: true,
        value: isPlainObject(parsed) ? parsed : undefined
      };
    } catch {
      return { ok: false, result: failure("Invalid JSON arguments") };
    }
  }
  return { ok: true, value: isPlainObject(raw) ? raw : undefined };
}

// -----------------------------------------------------------------------------
// Step 2: tool resolution

function resolveTool(
  functionName: string
): StepResult<{ tool: ToolMeta; fn: ToolCallable }> {
  const tool = TOOLS_BY_NAME.get(functionName);
  if (!tool) {
    return { ok: false, result: failure(`Tool not found: ${functionName}`) };
  }
  if (tool.disable) {
    return { ok: false, result: failure(`Tool disabled: ${functionName}`) };
  }

  const moduleFunctions = FUNCTION_REGISTRY[tool.module as ModuleName];
  if (!moduleFunctions) {
    return { ok: false, result: failure(`Module not found: ${tool.module}`) };
  }

  const fn = (moduleFunctions as Record<string, unknown>)[tool.name];
  if (typeof fn !== "function") {
    return {
      ok: false,
      result: failure(
        `Function not found: ${tool.name} in module ${tool.module}`
      )
    };
  }
  return { ok: true, value: { tool, fn: fn as ToolCallable } };
}

// -----------------------------------------------------------------------------
// Step 3: positional-arg construction
//
// Identity is provided ambiently via ALS (see invokeWithinAuthScope), not as
// positional args. The only auth-shaped write here is object-level enrichment
// of the single `injectInto` target — mirrors main's behavior so service
// functions that spread the payload object into a DB row still get
// server-stamped identity fields.

function buildPositionalArgs(
  tool: ToolMeta,
  payload: Record<string, unknown> | undefined,
  context: ExecutorContext
): StepResult<unknown[]> {
  const args: unknown[] = [];
  for (const rawParam of tool.serviceParams) {
    const optional = rawParam.endsWith("?");
    const paramName = optional ? rawParam.slice(0, -1) : rawParam;

    const supplied = resolveParamValue(paramName, tool.serviceParams, payload);

    if (supplied.found) {
      const value =
        tool.injectInto === paramName
          ? enrichWithAuthContext(supplied.value, context, tool.injectAuth)
          : supplied.value;
      args.push(value);
      continue;
    }

    if (optional) continue;
    return {
      ok: false,
      result: failure(
        `Missing required parameter "${paramName}" for ${tool.id}`
      )
    };
  }
  return { ok: true, value: args };
}

interface ParamLookup {
  found: boolean;
  value?: unknown;
}

function resolveParamValue(
  paramName: string,
  serviceParams: string[],
  payload: Record<string, unknown> | undefined
): ParamLookup {
  if (!payload) return { found: false };

  if (paramName in payload) {
    return { found: true, value: payload[paramName] };
  }

  // Single-key payload whose name doesn't match any declared parameter:
  // unwrap and use as positional. Handles `{ args: {...} }` wrappers and any
  // LLM-guessed key name (e.g. `{ item: {...} }`).
  const payloadKeys = Object.keys(payload);
  if (payloadKeys.length !== 1) return { found: false };

  const declaredNames = serviceParams.map((p) =>
    p.endsWith("?") ? p.slice(0, -1) : p
  );
  const anyDeclaredKeyInPayload = declaredNames.some((p) => p in payload);
  if (anyDeclaredKeyInPayload) return { found: false };

  return { found: true, value: payload[payloadKeys[0]] };
}

// Stamps server-controlled identity onto a payload object. `createdBy` is
// preserved when the caller already supplied it (insert-only semantics);
// `updatedBy` and `companyId` are always overwritten by server values.
function enrichWithAuthContext(
  value: unknown,
  context: ExecutorContext,
  fields: AuthField[]
): unknown {
  if (!isPlainObject(value) || fields.length === 0) return value;
  const enriched: Record<string, unknown> = { ...value };
  if (fields.includes("createdBy") && !("createdBy" in enriched)) {
    enriched.createdBy = context.userId;
  }
  if (fields.includes("updatedBy")) {
    enriched.updatedBy = context.userId;
  }
  if (fields.includes("companyId")) {
    enriched.companyId = context.companyId;
  }
  return enriched;
}

// -----------------------------------------------------------------------------
// Step 4: invocation
//
// Identity (userId/companyId/...) and the Supabase client are made available
// to service code via AsyncLocalStorage. The single ALS scope established
// here is the sole authoritative identity source for the duration of the
// call.

async function invokeWithinAuthScope(
  fn: ToolCallable,
  args: unknown[],
  context: ExecutorContext
): Promise<LegacyExecutorResult> {
  try {
    const result = await AuthContextHolder.run(
      {
        client: context.client,
        userId: context.userId,
        sessionUserId: context.sessionUserId ?? context.userId,
        email: context.email ?? "",
        companyId: context.companyId,
        companyGroupId: context.companyGroupId ?? ""
      },
      () =>
        AuthClientScope.run(() => {
          AuthClientScope.setFactory(() => context.client);
          return fn(...args);
        })
    );

    // Service functions occasionally return an un-awaited Supabase query
    // builder (thenable). Awaiting it executes the underlying request.
    if (isThenable(result)) {
      return { success: true, data: await result };
    }
    return { success: true, data: result };
  } catch (error) {
    return failure(sanitizeErrorMessage(error));
  }
}

// -----------------------------------------------------------------------------
// Helpers

function failure(error: string): LegacyExecutorResult {
  return { success: false, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

// Surface a caller-safe message. We keep `error.message` so agents can
// distinguish failure modes; we drop stacks and non-Error throws.
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Tool execution failed";
}
