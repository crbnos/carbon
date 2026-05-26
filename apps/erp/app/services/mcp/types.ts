// Domain types for the MCP tool annotation surface.
//
// The annotation literal passed to `mcpTool()` is read at build time by
// `scripts/generate-mcp-manifest.ts` and emitted into `mcp-tools.json`.
// At runtime the wrapper is a no-op identity function, so these types
// describe the literal shape — they are not consulted by the executor.

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

// Service functions are heterogeneous by design (different positional shapes
// per service). `any[]` is the deliberate escape hatch needed so the `mcpTool`
// generic accepts every concrete service signature; the runtime contract is
// enforced by `serviceParams` in `mcp-tools.json`, not by TS structural typing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type McpToolFn = (...args: any[]) => unknown;

// One identity-injection binding: supply the server-controlled value `as`
// (companyId/userId/createdBy/updatedBy) into a positional parameter named
// `param`. When `param` is omitted, identity flows at the top level (the
// runtime executor resolves the target heuristically).
export interface InjectBinding {
  param?: string;
  as: AuthField;
}

// Slim annotation: only the fields a human must decide. `name`, `module`,
// `argOrder`, and `description` are derived at build time from the source
// (file path + function declaration). `schema` is optional and informational
// — the runtime executor does not currently validate against it; service
// functions own their own input validation.
export interface McpToolAnnotation {
  classification: McpClassification;
  schema?: ZodTypeAny;
  inject?: InjectBinding[];
  description?: string;
  disable?: boolean;
  // Positional fallback: required only when the function destructures a
  // parameter (the AST walker cannot infer positional names in that case).
  argOrder?: string[];
  /** @deprecated transitional alias for `schema`. */
  paramSchema?: ZodTypeAny;
  /** @deprecated transitional — superseded by `inject`. */
  injectAuth?: AuthField[];
  /** @deprecated transitional — superseded by `inject`. */
  injectInto?: string;
}
