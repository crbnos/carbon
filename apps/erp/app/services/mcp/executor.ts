import { AuthClientScope, AuthContextHolder } from "./auth-context";
import { BLOCKED_TOOL_IDS } from "./blocked";
import { McpToolRegistry } from "./registry";
import type { McpClassification, McpToolMetadata } from "./types";

export interface ExecutorContext {
  client: unknown;
  companyId: string;
  userId: string;
  // Step 2: the full AuthContext carries these too. Optional here so existing
  // MCP callers need no change yet; the executor fills sensible defaults
  // (sessionUserId := userId, companyGroupId := "") when establishing the
  // scope. Once the MCP route runs under the auth middleware these will be
  // sourced from the ambient scope instead of reconstructed.
  sessionUserId?: string;
  companyGroupId?: string;
  // Same optional-with-default treatment as the fields above. Defaults to ""
  // (no associated email) — matches the API-key identity path in
  // resolveAuthContext, so MCP tool execution behavior is unchanged.
  email?: string;
}

export type ExecutorErrorCode =
  | "INVALID_JSON"
  | "TOOL_NOT_FOUND"
  | "INVALID_ARGUMENTS"
  | "MISSING_REQUIRED_PARAM"
  | "FORBIDDEN"
  | "EXECUTION_FAILED";

// Authorization hook: caller-provided gate that runs *before* the tool fn.
// Returns null to allow, or a denial reason. Default policy allows everything
// (preserves current behaviour); deployers wire stricter checks at the route.
export type ExecutorAuthorize = (
  classification: McpClassification,
  toolId: string,
  context: ExecutorContext
) => string | null;

const allowAll: ExecutorAuthorize = () => null;

export type ExecutorResult =
  | { ok: true; data: unknown }
  | { ok: false; code: ExecutorErrorCode; message: string };

export interface ExecutorLogger {
  error(message: string, error: unknown): void;
}

const defaultLogger: ExecutorLogger = {
  error: (m, e) => {
    console.error(m, e);
    if (e instanceof Error && e.stack) console.error(e.stack);
  }
};

// Identity keys we never accept from callers — server context always wins.
const IDENTITY_KEYS = [
  "userId",
  "companyId",
  "createdBy",
  "updatedBy"
] as const;

// argOrder keys populated from ExecutorContext rather than caller payload.
// Used when sweeping nested object params for identity stripping (we skip
// these because they're not caller-controlled in the first place).
const CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "client",
  "userId",
  "companyId"
]);

export class ToolExecutor {
  constructor(
    private readonly registry: McpToolRegistry = McpToolRegistry.getInstance(),
    private readonly logger: ExecutorLogger = defaultLogger,
    private readonly authorize: ExecutorAuthorize = allowAll
  ) {}

  async execute(
    toolId: string,
    context: ExecutorContext,
    rawArgs: Record<string, unknown> | string | undefined
  ): Promise<ExecutorResult> {
    if (BLOCKED_TOOL_IDS.has(toolId)) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: `Tool is blocked: ${toolId}`
      };
    }

    const parsed = parsePayload(rawArgs);
    if (!parsed.ok) return parsed;

    const meta = this.registry.get(toolId);
    if (!meta) {
      return {
        ok: false,
        code: "TOOL_NOT_FOUND",
        message: `Tool not registered: ${toolId}`
      };
    }

    const denied = this.authorize(meta.classification, toolId, context);
    if (denied !== null) {
      return { ok: false, code: "FORBIDDEN", message: denied };
    }

    // Only honour the legacy `{ args: {...} }` wrapper when the tool itself
    // doesn't declare `args` as a real parameter — otherwise we'd silently
    // strip the wrapper a service function is asking for.
    const rawPayload = parsed.payload ?? {};
    const payload =
      !meta.hasArgsParam &&
      "args" in rawPayload &&
      Object.keys(rawPayload).length === 1 &&
      rawPayload.args &&
      typeof rawPayload.args === "object" &&
      !Array.isArray(rawPayload.args)
        ? (rawPayload.args as Record<string, unknown>)
        : rawPayload;

    const validated = validatePayload(meta, payload);
    if (!validated.ok) return validated;

    // Server-controlled identity is never caller-supplied. Strip it from the
    // top-level payload, then from every nested object positional param the
    // tool declares. This is now purely a *defensive* measure: identity no
    // longer flows through arguments at all — it is provided ambiently via
    // AuthContextHolder (ALS), sourced only from the server `context` below.
    // Stripping remains so a caller cannot smuggle `companyId`/`userId` into
    // a payload object that a service function happens to spread into a row.
    const safePayload = stripIdentity(validated.payload);
    for (const key of meta.argOrder) {
      if (CONTEXT_KEYS.has(key)) continue;
      const value = safePayload[key];
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
      ) {
        safePayload[key] = stripIdentity(value as Record<string, unknown>);
      }
    }

    // Reconstruct positional args from the caller payload. CONTEXT_KEYS
    // (client/userId/companyId) are NEVER taken from the payload — they are
    // server-controlled and supplied from `context`. This is robust whether
    // or not the generated manifest's argOrder still lists those context
    // params: a stale manifest (argOrder includes "client"/"userId"/
    // "companyId") would otherwise make every tool call fail
    // MISSING_REQUIRED_PARAM because callers never send identity. Service
    // functions additionally read identity from AuthContextHolder in their
    // body; passing it positionally here is harmless for any signature that
    // still declares it and ignored by those that do not.
    const args: unknown[] = new Array(meta.argOrder.length);
    for (let i = 0; i < meta.argOrder.length; i++) {
      const key = meta.argOrder[i];
      if (CONTEXT_KEYS.has(key)) {
        args[i] =
          key === "client"
            ? context.client
            : key === "userId"
              ? context.userId
              : context.companyId;
      } else if (key in safePayload) {
        args[i] = safePayload[key];
      } else if (meta.optional[i]) {
        args[i] = undefined;
      } else {
        return {
          ok: false,
          code: "MISSING_REQUIRED_PARAM",
          message: `Missing required parameter "${key}" for ${toolId}`
        };
      }
    }

    // Establish the per-request auth scope for the duration of the tool call
    // (and everything it awaits). This is the SOLE authoritative source of
    // identity at runtime; it is fed only from the server-resolved `context`,
    // never from caller input. ALS isolates this per async execution, so
    // concurrent tool calls never observe each other's identity.
    //
    // The client factory is also registered for the MCP scope so that tools
    // using getAuthClient() (instead of receiving client positionally) can
    // resolve their Supabase handle.
    try {
      const data = await AuthContextHolder.run(
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
            return meta.fn(...args);
          })
      );
      return { ok: true, data };
    } catch (error) {
      this.logger.error(`[mcp] tool ${toolId} threw`, error);
      return {
        ok: false,
        code: "EXECUTION_FAILED",
        message: sanitizeErrorMessage(error)
      };
    }
  }
}

function stripIdentity(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  for (const k of IDENTITY_KEYS) delete out[k];
  return out;
}

// Surface a caller-safe message. We keep `error.message` (so agents can
// distinguish "row not found" from "constraint violation" and recover) but
// drop stacks and any non-Error throw shapes that might leak internals.
function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Tool execution failed";
}

function parsePayload(
  raw: Record<string, unknown> | string | undefined
):
  | { ok: true; payload: Record<string, unknown> | undefined }
  | { ok: false; code: "INVALID_JSON"; message: string } {
  if (raw === undefined) return { ok: true, payload: undefined };
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, payload: undefined };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, payload: parsed as Record<string, unknown> };
      }
      return { ok: true, payload: undefined };
    } catch {
      return {
        ok: false,
        code: "INVALID_JSON",
        message: "Invalid JSON arguments"
      };
    }
  }
  return { ok: true, payload: raw };
}

function validatePayload(
  meta: McpToolMetadata,
  payload: Record<string, unknown>
):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; code: "INVALID_ARGUMENTS"; message: string } {
  const result = meta.paramSchema.safeParse(payload);
  if (!result.success) {
    return {
      ok: false,
      code: "INVALID_ARGUMENTS",
      message: `Invalid arguments for ${meta.id}: ${result.error.message}`
    };
  }
  // For z.unknown() placeholders, result.data may be the raw payload — but
  // we keep object-typed payloads regardless. If a tool deliberately accepts
  // a non-object, that's a future migration; today every tool expects an
  // object-shaped payload (or no payload).
  const data = result.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return { ok: true, payload: data as Record<string, unknown> };
  }
  return { ok: true, payload: payload };
}
