// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

// The MCP server's connect-time instructions, in their own module so they are
// testable without server.ts's import chain (callOperation → auth → env). The
// tool catalog is passed in (the generated `tool-metadata.json` lives in the app,
// derived from its `~/modules/*`), never imported here.
import type { ManifestEntry } from "@carbon/api";
import { MCP_DEFAULT_LIMIT } from "./format-result";

export type ToolCatalogSummary = {
  tools: Pick<ManifestEntry, "module">[];
  totalTools: number;
  modules: number;
};

// Read on every connect, so kept short. One call per record costs a turn per
// record, and every turn re-reads the whole conversation; one CSV call does not.
// The tool names are pinned against the catalog by describe-format.test.ts.
export const BULK_DATA_TOOLS = [
  "shared_importCsvText",
  "shared_getCsvImportFields"
] as const;

const BULK_DATA_INSTRUCTIONS = `
BULK DATA:
To create or update more than a few records of one kind, use
shared_importCsvText when it takes that table, not one call per record: one
call loads up to about 200 rows for far fewer tokens and requests. Build the CSV yourself from whatever the
user gives you; shared_getCsvImportFields lists a table's columns. Send
dryRun: true first, then import, without explaining these steps to the user.
The dry run reports what to settle with the user, in one message, before
importing. missing: required values that are empty; ask for them by row and
field. mismatched: values that match no option or record; correct one when
the right value is clear, otherwise ask. defaults: the values Carbon gives new
records where the file is empty; list them so the user can confirm or change
them. The user can fix their file and ask again, or answer here; then write
the answers into the file if you can, and import. When the user has many
records to enter, mention that you can read a CSV or Excel file they attach or
put in the project folder.`;

export function getServerInstructions(
  today: string,
  toolMetadata: ToolCatalogSummary
): string {
  const moduleNames = [
    ...new Set(toolMetadata.tools.map((tool) => tool.module))
  ].sort();
  return `Carbon ERP Manufacturing System
==========================================
Date: ${today}

IMPORTANT: Tool Discovery System
This server has ${toolMetadata.totalTools} tools available across ${toolMetadata.modules} modules:
${moduleNames.join(", ")}

To prevent context exhaustion, tools are loaded on-demand using call_tool.

USAGE:
1. Use search_tools to discover available tool names
2. Use describe_tool to get the schema for one or more tools
3. Use call_tool to execute any tool with its parameters

EXAMPLES:
// Step 1: Discover tools (ranked search; abbreviations like PO/RMA/BOM work)
search_tools({ query: "customer" })
// Returns tool names like: sales_getCustomers, sales_getCustomersList

// Step 2 (optional): Get tool schemas — batch several names in one call
describe_tool({ name: "sales_getCustomers" })
describe_tool({ names: ["sales_getCustomers", "sales_upsertCustomer"] })

// Step 3: Call the tool. The parameters go straight in "arguments" — the ones
// describe_tool lists, nothing wrapped around them.
call_tool({
  name: "sales_getCustomers",
  arguments: { limit: 10 }
})

SEARCH EXAMPLES:
search_tools({ query: "customer" })     // Find customer-related tools
search_tools({ module: "sales" })       // Find all sales module tools
search_tools({ classification: "READ" }) // Find read-only tools

KEY PATTERNS:
- companyId/userId are auto-filled
- call_tool.arguments is always a JSON object (never a stringified JSON blob)
- Pass parameters flat in "arguments"; a legacy { args: {…} } envelope is still
  accepted, but describe_tool shows the shape to send
- Responses: { data, error?, count? }
- Results omit null fields — an absent field means null
- List reads default to ${MCP_DEFAULT_LIMIT} rows; pass limit/offset to page
- Dates: ISO 8601 (YYYY-MM-DD)
- Pagination: limit/offset
${BULK_DATA_INSTRUCTIONS}`;
}
