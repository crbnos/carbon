// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * How a service function becomes an MCP / v1-API tool: it SAYS so, in its doc
 * comment. Nothing about a tool is read off the function's name.
 *
 * ```ts
 * /**
 *  * Creates or updates a customer.
 *  * @mcp upsert
 *  *\/
 * export async function upsertCustomer(…)
 * ```
 *
 * The published name is still `{module}_{functionName}`; everything else — what
 * the tool is, which permission it needs, which audit fields it is handed — is
 * declared.
 *
 * It used to be inferred. Every exported function was a tool, and its name
 * decided the rest: `get*` was a read whatever it did (two that inserted rows
 * were published on `view`), `upsert*` meant "stamp createdBy and updatedBy"
 * whether or not the table had them (`items_upsertItemCustomerPart` failed
 * every call with PGRST204), and a read named `diffMethod` demanded `update`.
 * Blocking tools one at a time reached 18 entries against 1557 tools while 211
 * tools had no in-app caller at all.
 */

import type { AuthField, Classification, PermissionAction } from "@carbon/api";

/**
 * Modules whose functions may be exposed at all. A module absent here exposes
 * nothing, whatever its functions are tagged with — the coarse gate, so taking
 * a whole domain off the API is one line rather than a tagging sweep.
 */
export const MCP_MODULE_ALLOWLIST: readonly string[] = [
  "account",
  "accounting",
  "documents",
  "inventory",
  "invoicing",
  "items",
  "people",
  "production",
  "purchasing",
  "quality",
  "resources",
  "sales",
  "settings",
  "shared",
  "users"
];

/**
 * The one tag. Every line a function says about itself as a tool starts with
 * it, in lowercase:
 *
 * ```
 * @mcp <verb> [destructive]      required — no such line, not a tool
 * @mcp permission <module>:<action>[+<action>]
 * @mcp audit <field>[, <field>]
 * @mcp key <table> <column>[=<field>][, …]
 * ```
 *
 * Free text after a declaration is a note for the reader
 * (`@mcp upsert destructive — it delegates to …`).
 */
export const MCP_EXPOSURE_TAG = "@mcp";

/**
 * The verbs, and what each one means for the tool. This table is the whole
 * contract: the generator copies these values and never looks at a name.
 *
 * `audit` is what the dispatcher stamps onto the payload besides `companyId`.
 * A field the function's one table has no column for is still dropped, and a
 * payload that declares its own `userId` still gets it — both are read from
 * the schema and the signature, not guessed.
 *
 * `action` is a state change that is not a row edit — lock a period, complete
 * an operation, finalize a quote. It needs `update` and is handed no audit
 * fields; the service or the function it calls records who did it.
 */
export const MCP_VERBS = {
  read: { classification: "READ", actions: ["view"], audit: [] },
  create: {
    classification: "WRITE",
    actions: ["create"],
    audit: ["createdBy", "updatedBy"]
  },
  update: {
    classification: "WRITE",
    actions: ["update"],
    audit: ["updatedBy"]
  },
  upsert: {
    classification: "WRITE",
    actions: ["create", "update"],
    audit: ["createdBy", "updatedBy"]
  },
  delete: { classification: "DESTRUCTIVE", actions: ["delete"], audit: [] },
  action: { classification: "WRITE", actions: ["update"], audit: [] }
} as const satisfies Record<
  string,
  {
    classification: Classification;
    actions: readonly PermissionAction[];
    audit: readonly AuthField[];
  }
>;

export type McpVerb = keyof typeof MCP_VERBS;

/**
 * The word after the verb for a write that can REMOVE data the caller did not
 * name — a delete-then-reinsert upsert drops whatever was left out of the
 * payload. It only changes how the tool is labelled to a client; permission
 * and audit fields stay the verb's. The generator refuses a write whose body
 * deletes rows without it, and refuses `read` on a body that writes at all.
 */
export const MCP_DESTRUCTIVE = "destructive";

/**
 * The words that start an `@mcp` line which is a SETTING rather than the verb.
 *
 * `permission <module>:<action>[+<action>]` — only when the tool gates on
 * something other than its own module and its verb's action. `getApiKeys`
 * lives in settings but is an admin capability: its route gates on
 * `users:update`, so a settings-scoped key must not read the key list.
 *
 * `audit <field>[, <field>]` — only when the verb's audit fields are wrong for
 * INTENT the schema cannot express, and stated in full (plus `companyId`, which
 * is always stamped). A ledger insert takes `createdBy` alone: the `updatedBy`
 * column exists, but a ledger row is never edited and a stamped `updatedBy`
 * would break its "untouched since creation" guarantee.
 *
 * `key <table> <column>[=<field>][, …]` — the row an upsert UPDATES when it
 * already exists, for a service whose payload cannot say whether it is creating
 * or updating. Most upserts take an optional `id`: sent means update, omitted
 * means create, and the generator reads that off the parameter's type. A few
 * cannot be read that way — a part's `id` is its part number on create and its
 * item id (or part number) on update; a pick method has no id at all, only an
 * item and a location. For those the dispatcher looks the row up, scoped to the
 * caller's company, and updates when it is there. `column` is compared with the
 * payload field of the same name unless `=<field>` names another, and several
 * `key` lines are alternatives. These tools used to demand a
 * `_operation: "create" | "update"` argument, which made every caller state
 * something the server could find out.
 */
export const MCP_SETTINGS = {
  permission: "permission",
  audit: "audit",
  key: "key"
} as const;
