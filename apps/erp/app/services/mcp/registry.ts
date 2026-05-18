import { BLOCKED_TOOL_IDS } from "./blocked";
import {
  MCP_TOOL_ANNOTATION,
  type McpToolAnnotation,
  type McpToolFn,
  type McpToolMetadata,
  type McpToolParsed,
  type McpToolRegistration
} from "./types";

export interface RegistryLogger {
  warn(message: string): void;
}

const defaultLogger: RegistryLogger = {
  warn: (m) => console.warn(m)
};

// argOrder keys that the executor populates from ExecutorContext, not from
// the caller's payload. Used to infer a default `injectInto` target: if a
// tool's argOrder is exactly one context key plus one object key, the object
// is unambiguously the identity-injection target.
//
// `db` is included alongside `client` because a handful of services declare
// their first positional as a Kysely handle named `db` rather than a
// SupabaseClient named `client`. Both are populated from `context.client`.
const CONTEXT_KEYS: ReadonlySet<string> = new Set([
  "client",
  "db",
  "userId",
  "companyId"
]);

export class McpToolRegistry {
  private static instance: McpToolRegistry | null = null;
  private readonly tools = new Map<string, McpToolMetadata>();
  private readonly logger: RegistryLogger;

  constructor(logger: RegistryLogger = defaultLogger) {
    this.logger = logger;
  }

  static getInstance(): McpToolRegistry {
    if (!this.instance) this.instance = new McpToolRegistry();
    return this.instance;
  }

  // Registration from a generator-emitted call: the function carries its slim
  // annotation as a symbol-keyed property; the parsed metadata (module/name/
  // argOrder) comes from the AST walk. Merging happens here so the executor
  // sees the same fat McpToolMetadata shape as before.
  registerParsed(fn: McpToolFn, parsed: McpToolParsed): void {
    const annotation = (fn as unknown as Record<symbol, unknown>)[
      MCP_TOOL_ANNOTATION
    ] as McpToolAnnotation | undefined;
    if (!annotation) {
      throw new Error(
        `mcpTool() registerParsed: function "${parsed.module}.${parsed.name}" is missing its annotation tag — was it wrapped with mcpTool()?`
      );
    }
    // Build the strict registration explicitly. `description` and `inject`
    // are build-time derived (carried by `parsed`); they are intentionally
    // absent from the slim runtime annotation, so a `{...annotation,
    // ...parsed}` spread would leave `description` undefined and silently
    // drop identity injection. `paramSchema` is the honest default supplied
    // by mcpTool(); `classification`/`disable`/`schema` come from the
    // literal. The legacy injectAuth/injectInto pair is no longer consulted
    // here — the generator resolved it into `parsed.inject` at build time.
    if (!annotation.paramSchema) {
      throw new Error(
        `mcpTool() registerParsed: "${parsed.module}.${parsed.name}" annotation is missing paramSchema — mcpTool() should have defaulted it to z.unknown()`
      );
    }
    this.register(
      {
        module: parsed.module,
        name: parsed.name,
        argOrder: parsed.argOrder,
        description: parsed.description,
        classification: annotation.classification,
        disable: annotation.disable,
        paramSchema: annotation.paramSchema,
        inject: parsed.inject,
        // Legacy fields resolved at build time into `inject`; kept empty so
        // the strict McpToolRegistration contract is satisfied and the
        // register() fallback branch is never taken for parsed tools.
        injectAuth: []
      },
      fn
    );
  }

  register(registration: McpToolRegistration, fn: McpToolFn): void {
    if (!registration.name)
      throw new Error("mcpTool() requires registration.name");
    if (!registration.paramSchema)
      throw new Error(
        `mcpTool() requires paramSchema for "${registration.module}_${registration.name}". ` +
          `Use z.unknown() as an explicit placeholder if a precise schema is not yet authored.`
      );

    const id = `${registration.module}_${registration.name}`;
    if (BLOCKED_TOOL_IDS.has(id)) {
      this.logger.warn(
        `[McpToolRegistry] Refusing to register blocklisted tool "${id}".`
      );
      return;
    }
    if (this.tools.has(id)) {
      // HMR in dev re-runs module top level and re-registers; that's expected.
      // In prod a duplicate id is a programming error (two services sharing a
      // name) — failing loud at boot beats serving the wrong fn for the life
      // of the process.
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          `mcpTool() duplicate tool id "${id}". Two mcpTool() calls share this name; rename one.`
        );
      }
      this.logger.warn(
        `[McpToolRegistry] Duplicate tool id "${id}" — keeping first registration (dev/HMR).`
      );
      return;
    }

    const argOrder: string[] = [];
    const optional: boolean[] = [];
    let hasArgsParam = false;
    for (const raw of registration.argOrder) {
      const isOpt = raw.endsWith("?");
      const name = isOpt ? raw.slice(0, -1) : raw;
      argOrder.push(name);
      optional.push(isOpt);
      if (name === "args") hasArgsParam = true;
    }

    // Resolve the identity-injection contract. Prefer the unified `inject`
    // list (the single source of truth from the annotation); fall back to
    // the legacy injectAuth/injectInto pair during the codemod transition.
    //
    // `McpToolMetadata` models injection as one target param + a flat
    // identity set, which faithfully captures every real tool (all stamp
    // their whole identity set into one place). Collapsing `inject` into
    // that shape is therefore safe — but ONLY if every binding shares one
    // target. We assert that here so a future per-param `inject` cannot
    // silently lose bindings; it would fail loud and force this model to
    // be widened deliberately.
    let resolvedInjectAuth: string[];
    let resolvedInjectInto: string | undefined;
    if (registration.inject && registration.inject.length > 0) {
      const targets = new Set(
        registration.inject
          .map((b) => b.param)
          .filter((p): p is string => p !== undefined && p !== "")
      );
      if (targets.size > 1) {
        throw new Error(
          `mcpTool() ${id}: inject targets multiple params [${[...targets].join(", ")}]; ` +
            `the registry models a single injection target. Widen McpToolMetadata before using per-param inject.`
        );
      }
      resolvedInjectAuth = [...new Set(registration.inject.map((b) => b.as))];
      resolvedInjectInto = targets.size === 1 ? [...targets][0] : undefined;
    } else {
      resolvedInjectAuth = registration.injectAuth;
      resolvedInjectInto = registration.injectInto;
    }

    // Runtime guard (defense-in-depth beyond the build-time check in the
    // manifest generator): a named injection target must be a real param.
    if (resolvedInjectInto && !argOrder.includes(resolvedInjectInto)) {
      throw new Error(
        `mcpTool() ${id}: injectInto "${resolvedInjectInto}" is not in argOrder [${argOrder.join(", ")}]`
      );
    }

    // Default injectInto: when the tool requests identity injection but
    // didn't specify a target, and argOrder contains exactly one non-context
    // key, infer that key as the target. Restores the pre-refactor behaviour
    // for the common `(client, payload)` / `(client, args)` shape without
    // requiring every callsite to spell it out. Without this default the
    // executor would stamp identity at the top level of `merged` where it
    // never reaches the positional object the service function reads from.
    const wantsAuthInjection = resolvedInjectAuth.length > 0;
    let injectInto = resolvedInjectInto;
    if (!injectInto && wantsAuthInjection) {
      const payloadKeys = argOrder.filter((k) => !CONTEXT_KEYS.has(k));
      // Infer the sole non-context positional as the injection target,
      // regardless of its name. This faithfully restores the pre-refactor
      // contract (the old executor injected into whatever object param the
      // caller passed by name — not a conventional-name allowlist). The
      // ~229 upsert/update tools take a single domain-named object param
      // (`account`, `salesInvoice`, `receipt`, …); restricting inference to
      // `args/payload/data/...` silently dropped companyId/createdBy on all
      // of them. Safety against stamping into a primitive slot lives in the
      // executor: it only injects when the runtime value is an object and
      // otherwise leaves the positional untouched (mirrors the old
      // enrichWithAuthContext no-op-on-non-object behaviour). So a tool
      // like `(client, customerId)` is harmless — the executor will not
      // mutate the string.
      if (payloadKeys.length === 1) {
        injectInto = payloadKeys[0];
      }
    }

    // Sanity check: the function's declared arity should match argOrder.
    // Optional trailing params are allowed (default values reduce fn.length).
    if (fn.length > argOrder.length) {
      throw new Error(
        `mcpTool() ${id}: fn.length=${fn.length} exceeds argOrder.length=${argOrder.length}`
      );
    }

    this.tools.set(id, {
      id,
      module: registration.module,
      name: registration.name,
      description: registration.description.trim(),
      classification: registration.classification,
      disable: registration.disable ?? false,
      paramSchema: registration.paramSchema,
      argOrder,
      optional,
      hasArgsParam,
      auth: {
        companyId: resolvedInjectAuth.includes("companyId"),
        userId: resolvedInjectAuth.includes("userId"),
        createdBy: resolvedInjectAuth.includes("createdBy"),
        updatedBy: resolvedInjectAuth.includes("updatedBy")
      },
      injectInto,
      fn
    });
  }

  // Test-only escape hatch. The registry is a process-wide singleton, which
  // makes unit tests order-dependent. Production code should never call this.
  resetForTesting(): void {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "McpToolRegistry.resetForTesting is not allowed in production"
      );
    }
    this.tools.clear();
  }

  static resetForTesting(): void {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "McpToolRegistry.resetForTesting is not allowed in production"
      );
    }
    this.instance = null;
  }

  list(): McpToolMetadata[] {
    const out: McpToolMetadata[] = [];
    for (const t of this.tools.values()) if (!t.disable) out.push(t);
    return out;
  }

  get(id: string): McpToolMetadata | undefined {
    const t = this.tools.get(id);
    return t && !t.disable ? t : undefined;
  }

  size(): number {
    let n = 0;
    for (const t of this.tools.values()) if (!t.disable) n++;
    return n;
  }
}
