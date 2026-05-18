// Domain types for the MCP tool annotation framework.
// The registry is the in-memory source of truth, populated at boot by
// `registerAll()` from the generated `mcp-tools.generated.ts`.

import type { ZodTypeAny } from "zod";

export const Mcp = {
  READ: "READ",
  WRITE: "WRITE",
  DESTRUCTIVE: "DESTRUCTIVE",
  CompanyId: "companyId",
  UserId: "userId",
  CreatedBy: "createdBy",
  UpdatedBy: "updatedBy"
} as const;

export type McpClassification =
  | typeof Mcp.READ
  | typeof Mcp.WRITE
  | typeof Mcp.DESTRUCTIVE;
export type AuthField =
  | typeof Mcp.CompanyId
  | typeof Mcp.UserId
  | typeof Mcp.CreatedBy
  | typeof Mcp.UpdatedBy;

// Tool functions are heterogeneous by design (different positional shapes per
// service). `any[]` here is a deliberate escape hatch: the runtime contract is
// enforced by `argOrder` + `paramSchema`, not by TS structural typing. The
// registry asserts `argOrder.length === fn.length` at registration time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type McpToolFn = (...args: any[]) => unknown;

// One identity-injection binding: supply the server-controlled value `as`
// (companyId/userId/createdBy/updatedBy) to the tool.
//
// `param` names the function parameter that receives it and, when present,
// must be a real parameter name (verified at build time by the manifest
// generator, guarded again at runtime by the executor). The executor
// decides the mechanic from the param's runtime value: an object value
// receives `as` as a key inside it; a primitive positional is set to the
// server value directly.
//
// `param` is OPTIONAL. Omitting it is the common case (the legacy
// `injectAuth` with no `injectInto`): identity flows at the top level and
// the registry's single-non-context-key heuristic resolves the target.
export interface InjectBinding {
  param?: string;
  as: AuthField;
}

// Slim annotation: only the fields a human must decide and the build-time
// AST parser cannot honestly recover from source.
//
// Derived by the manifest generator (omit from the literal):
//   - `name`, `module`, `argOrder` — from the fn declaration / path / params.
//   - `description` — de-camelCased function name.
//
// Stay explicit:
//   - `classification` — READ/WRITE/DESTRUCTIVE authorization gate (security
//     boundary, never inferred).
//   - `inject` — the identity-injection contract (security boundary).
//   - `schema` — the real zod validator for the payload. Use the actual
//     validator already referenced in the signature (`z.infer<typeof X>`);
//     use `z.unknown()` ONLY where the input is genuinely unstructured
//     (`Json`/`Database`). Consumed at runtime by the executor.
//
// `description` is optional (generator-derived). `schema` is optional only
// so read tools over unstructured input can omit it (defaults to
// `z.unknown()` downstream). `paramSchema`/`injectAuth`/`injectInto` are
// retained, optional, ONLY for the codemod transition: `paramSchema` is the
// old name for `schema`; `injectAuth`/`injectInto` normalize into `inject`.
export interface McpToolAnnotation {
  classification: McpClassification;
  schema?: ZodTypeAny;
  inject?: InjectBinding[];
  description?: string;
  disable?: boolean;
  // Positional fallback: required ONLY when the function destructures a
  // parameter, so the build-time AST walk cannot infer positional names.
  // For plain-identifier params the generator derives this and the codemod
  // strips it from the literal.
  argOrder?: string[];
  /** @deprecated transitional — renamed to `schema`. Removed by codemod. */
  paramSchema?: ZodTypeAny;
  /** @deprecated transitional — superseded by `inject`. Removed by codemod. */
  injectAuth?: AuthField[];
  /** @deprecated transitional — superseded by `inject`. Removed by codemod. */
  injectInto?: string;
}

// Symbol attached to every wrapped fn so the generator-emitted
// `registerAll()` can recover the slim annotation at registration time
// without the wrapper having to register eagerly. Globally-keyed so the same
// symbol resolves across module-graph copies (HMR, dual bundling, etc.).
export const MCP_TOOL_ANNOTATION = Symbol.for("carbon.mcp.tool.annotation");

// Parsed metadata the generator extracts from each `mcpTool({...}, fn)` call
// site. Combined with the slim annotation at runtime to produce a full
// McpToolMetadata.
//
// `description` and `inject` are *derived/resolved at build time* (the
// de-camelCased fn name; the unified inject list normalized from
// `inject`/`injectAuth`/`injectInto`). They are carried here because the
// slim runtime annotation deliberately does not contain them — without
// this the registry would have no description to register and no identity
// set to inject, silently dropping server auth on every write tool.
export interface McpToolParsed {
  module: string;
  name: string;
  argOrder: string[];
  description: string;
  inject: InjectBinding[];
}

// Full registration input — slim annotation plus the parsed bits, with the
// runtime-essential fields re-required. The annotation literal may omit
// `description`/`paramSchema` (the generator derives them) and use the
// transitional `injectAuth`/`injectInto`; by the time a tool reaches
// `register()` those have been resolved, so the internal contract is strict.
export interface McpToolRegistration extends McpToolAnnotation {
  module: string;
  name: string;
  argOrder: string[];
  description: string;
  paramSchema: ZodTypeAny;
  injectAuth: AuthField[];
}

export interface AuthInjection {
  companyId: boolean;
  userId: boolean;
  createdBy: boolean;
  updatedBy: boolean;
}

export interface McpToolMetadata {
  id: string;
  module: string;
  name: string;
  description: string;
  classification: McpClassification;
  disable: boolean;
  fn: McpToolFn;
  paramSchema: ZodTypeAny;
  argOrder: string[];
  // Same length as argOrder; precomputed so the executor avoids per-call work.
  optional: boolean[];
  // True when the tool legitimately declares "args" as a parameter — disables
  // the executor's legacy `{ args: {...} }` unwrap so we don't eat it.
  hasArgsParam: boolean;
  auth: AuthInjection;
  // When set, the executor stamps the auth fields into the *object* value at
  // this positional key rather than the top-level payload.
  injectInto?: string;
}
