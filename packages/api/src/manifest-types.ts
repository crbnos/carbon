// Types for the generated Carbon API operation manifest (`@carbon/api/manifest`).
// The DATA is generated at build time into `src/manifest/` (gitignored) by
// `scripts/generate-mcp.ts`; these types are the committed contract consumers read
// against. Keep them in sync with the generator's output shape.

export type Classification = "READ" | "WRITE" | "DESTRUCTIVE";

/** Audit/identity fields the dispatcher stamps into a service payload. Mirrors the
 *  ERP MCP `AuthField` union — keep the two in lockstep. */
export type AuthField =
  | "companyId"
  | "companyGroupId"
  | "createdBy"
  | "updatedBy";

export type PermissionAction = "view" | "create" | "update" | "delete";

/**
 * The permission an API-key caller must hold to invoke the operation.
 * `module` is `null` for operations that gate only on a valid key of the company
 * (e.g. `account`, `shared`) rather than a specific permission module.
 */
export interface ToolPermission {
  module: string | null;
  actions: PermissionAction[];
}

/** One operation in the manifest — the successor of a `tool-metadata.json` entry. */
export interface ManifestEntry {
  name: string;
  module: string;
  classification: Classification;
  description: string;
  paramCount: number;
  serviceParams: string[];
  injectAuth: AuthField[];
  permission: ToolPermission;
  /** The JSON Schema for the operation's input. When the service branches on
   *  `"createdBy" in payload`, a required `_operation: "create" | "update"`
   *  property is present here — that property IS the marker (there is no parallel
   *  flag), matching how the dispatcher decides today. */
  schema: Record<string, unknown>;
  /** The JSON Schema for the operation's RESPONSE `data`, reflected from the
   *  service function's TypeScript return type — absent when nothing useful could
   *  be derived (an `any`, a void, or an opaque shape). Describes the payload the
   *  dispatcher puts in `data`, not the `{ data, count }` envelope around it. */
  responseSchema?: Record<string, unknown>;
}

/** One module's operations, as stored in `src/manifest/{module}.json`. */
export interface ModuleManifest {
  module: string;
  tools: ManifestEntry[];
}
