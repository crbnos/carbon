// The MCP server's connect-time instructions, in their own module so they are
// testable without server.ts's import chain (callOperation → auth → env).
import { MCP_DEFAULT_LIMIT } from "./format-result";
import toolMetadata from "./tool-metadata.json";

const MODULE_NAMES = [
  ...new Set(toolMetadata.tools.map((tool) => tool.module))
].sort();

export function getServerInstructions(today: string): string {
  return `Carbon ERP Manufacturing System
==========================================
Date: ${today}

IMPORTANT: Tool Discovery System
This server has ${toolMetadata.totalTools} tools available across ${toolMetadata.modules} modules:
${MODULE_NAMES.join(", ")}

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

// Step 3: Call the tool (arguments must be a JSON object, not a string)
call_tool({
  name: "sales_getCustomers",
  arguments: { args: { limit: 10 } }
})

SEARCH EXAMPLES:
search_tools({ query: "customer" })     // Find customer-related tools
search_tools({ module: "sales" })       // Find all sales module tools
search_tools({ classification: "READ" }) // Find read-only tools

KEY PATTERNS:
- companyId/userId are auto-filled
- call_tool.arguments is always a JSON object (never a stringified JSON blob)
- Responses: { data, error?, count? }
- Results omit null fields — an absent field means null
- List reads default to ${MCP_DEFAULT_LIMIT} rows; pass limit/offset to page
- Dates: ISO 8601 (YYYY-MM-DD)
- Pagination: limit/offset`;
}
