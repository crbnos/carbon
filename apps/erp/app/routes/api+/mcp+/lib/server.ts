// MCP server. Tool metadata comes from the in-memory McpToolRegistry, which is
// populated at app boot via `ensureMcpToolsLoaded()` (imports every annotated
// service file so its mcpTool() calls register with the registry).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpToolRegistry } from "~/services/mcp";
import { embedQuery } from "~/services/mcp/embedQuery";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  withErrorHandling,
} from "./types";
import type { McpContext } from "./types";
import { executeFunction } from "./direct-executor";

interface SearchRow {
  toolId: string;
  module: string;
  name: string;
  description: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  totalCount: number;
}

function getServerInstructions(): string {
  const today = new Date().toISOString().split("T")[0];
  const registry = McpToolRegistry.getInstance();
  const tools = registry.list();
  const moduleCount = new Set(tools.map((t) => t.module)).size;

  return `Carbon ERP Manufacturing System
==========================================
Date: ${today}

IMPORTANT: Tool Discovery System
This server has ${tools.length} tools available across ${moduleCount} modules.

To prevent context exhaustion, tools are loaded on-demand using call_tool.

USAGE:
1. Use search_tools to discover available tool names
2. Use describe_tool to get the schema for a specific tool
3. Use call_tool to execute any tool with its parameters

EXAMPLES:
// Step 1: Discover tools
search_tools({ query: "customer" })
// Returns tool names like: sales_getCustomers, sales_getCustomersList

// Step 2 (optional): Get tool schema
describe_tool({ name: "sales_getCustomers" })

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
- Dates: ISO 8601 (YYYY-MM-DD)
- Pagination: limit/offset`;
}

export function createMcpServer(ctx: McpContext): McpServer {
  const registry = McpToolRegistry.getInstance();

  const server = new McpServer(
    {
      name: "carbon-erp",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "1.0.0",
    },
    {
      instructions: getServerInstructions(),
    }
  );

  server.registerTool(
    "describe_tool",
    {
      description: "Get the schema and description for a specific tool",
      inputSchema: z.object({
        name: z.string().describe("The name of the tool to describe"),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withErrorHandling(async (params: any) => {
      const tool = registry.get(params.name);
      if (!tool) {
        return {
          content: [{ type: "text" as const, text: `Tool '${params.name}' not found` }],
          isError: true,
        };
      }

      let output = `Tool: ${tool.id}\n`;
      output += `Module: ${tool.module}\n`;
      output += `Classification: ${tool.classification}\n`;
      output += `Description: ${tool.description}\n`;
      if (tool.argOrder.length > 0) {
        output += `Service params: ${tool.argOrder.join(", ")}\n`;
      }

      output += `\nInput Schema:\n`;
      const schema = zodToJsonSchema(tool.paramSchema, { target: "openApi3" });
      output += JSON.stringify(schema, null, 2);

      return {
        content: [{ type: "text" as const, text: output }],
      };
    }, "Describe tool failed")
  );

  server.registerTool(
    "call_tool",
    {
      description: "Call any ERP tool by name with the specified parameters",
      inputSchema: z.object({
        name: z.string().describe("The name of the tool to call"),
        arguments: z.any().describe("The arguments to pass to the tool"),
      }),
      annotations: WRITE_ANNOTATIONS,
    },
    withErrorHandling(async (params: any) => {
      const { name, arguments: rawArgs } = params;
      let args = rawArgs;

      if (typeof args === "string") {
        try {
          args = args.trim().length > 0 ? JSON.parse(args) : {};
        } catch {
          return {
            content: [{ type: "text" as const, text: "Invalid JSON in call_tool.arguments" }],
            isError: true,
          };
        }
      }

      if (process.env.NODE_ENV !== "production" || process.env.MCP_DEBUG === "1") {
        console.log("[MCP Server] call_tool invoked:", { name, arguments: args });
      } else {
        console.log("[MCP Server] call_tool invoked:", { name });
      }

      const result = await executeFunction(name, ctx, args);

      if (result.success) {
        let output: string;

        if (
          result.data &&
          typeof result.data === "object" &&
          "data" in result.data &&
          "error" in result.data
        ) {
          if (result.data.error) {
            return {
              content: [
                { type: "text" as const, text: `Database error: ${JSON.stringify(result.data.error)}` },
              ],
              isError: true,
            };
          }
          output = JSON.stringify(result.data.data, null, 2);
        } else if (result.data) {
          output = JSON.stringify(result.data, null, 2);
        } else {
          output = "Operation completed successfully";
        }

        return { content: [{ type: "text" as const, text: output }] };
      }

      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    }, "Call tool failed")
  );

  // Semantic search backed by the mcpToolEmbedding table. Same input schema
  // as the substring version it replaced; output text format unchanged so
  // agent UX is preserved. When `query` is empty we skip the Ollama call and
  // page through mcpToolVersion directly, matching the previous "no query"
  // behavior.
  server.registerTool(
    "search_tools",
    {
      description: "Search for ERP tools by name, description, or module",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Natural-language query; semantic match over tool descriptions"),
        module: z.string().optional().describe("Filter by exact module name"),
        classification: z.enum(["READ", "WRITE", "DESTRUCTIVE"]).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    withErrorHandling(async (params: any) => {
      const { query, module, classification, limit = 20, offset = 0 } = params;
      const trimmedQuery = typeof query === "string" ? query.trim() : "";

      let rows: SearchRow[];
      let totalResults: number;

      if (trimmedQuery) {
        const embedding = await embedQuery(trimmedQuery);
        const { data, error } = await ctx.client.rpc("search_mcp_tools" as never, {
          query_embedding: embedding as unknown as string,
          filter_module: module ?? null,
          filter_classification: classification ?? null,
          result_limit: limit,
          result_offset: offset,
        } as never);
        if (error) throw new Error(error.message);
        rows = ((data as unknown) as SearchRow[]) ?? [];
        totalResults = rows[0]?.totalCount ?? rows.length;
      } else {
        let q = ctx.client
          .from("mcpToolVersion" as never)
          .select("toolId, module, name, description, classification", { count: "exact" })
          .eq("isActive" as never, true as never);
        if (module) q = q.eq("module" as never, module as never);
        if (classification) q = q.eq("classification" as never, classification as never);
        const { data, error, count } = await q
          .order("toolId" as never)
          .range(offset, offset + limit - 1);
        if (error) throw new Error(error.message);
        rows = ((data as unknown) as SearchRow[]) ?? [];
        totalResults = count ?? rows.length;
      }

      const toolNames = rows.map((t) => t.toolId);

      // When the semantic-search corpus is empty (the embeddings worker has
      // not populated `mcpToolEmbedding` yet) but the in-process registry
      // does know about tools, return a clearer message than "Found 0 tools".
      // The agent otherwise has no way to distinguish "your query matched
      // nothing" from "the index isn't ready".
      if (
        trimmedQuery &&
        totalResults === 0 &&
        rows.length === 0 &&
        registry.size() > 0
      ) {
        const message =
          `No semantic search results — the tool embedding index is not populated yet ` +
          `(or returned no matches for "${trimmedQuery}"). ` +
          `Retry without a query to list all ${registry.size()} active tools, ` +
          `or filter by module/classification.`;
        return {
          content: [{ type: "text" as const, text: message }],
          metadata: { toolNames: [], totalResults: 0, indexEmpty: true },
        };
      }

      let output = `Found ${totalResults} tools`;
      if (totalResults > limit) {
        output += ` (showing ${offset + 1}-${offset + rows.length})`;
      }
      output += ":\n\n";

      const byModule = new Map<string, SearchRow[]>();
      for (const tool of rows) {
        if (!byModule.has(tool.module)) byModule.set(tool.module, []);
        byModule.get(tool.module)!.push(tool);
      }

      for (const [mod, tools] of byModule.entries()) {
        output += `${mod.toUpperCase()} MODULE:\n`;
        for (const tool of tools) {
          output += `  • ${tool.toolId} [${tool.classification}]\n`;
          output += `    ${tool.description}\n`;
        }
        output += "\n";
      }

      if (toolNames.length > 0) {
        output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        output += `To use these tools:\n`;
        output += `1. Use describe_tool({ name: "tool_name" }) to see the schema\n`;
        output += `2. Use call_tool({ name: "tool_name", arguments: {...} })\n\n`;
        output += `Example:\n`;
        output += `call_tool({ \n`;
        output += `  name: "${toolNames[0]}",\n`;
        output += `  arguments: { /* tool parameters */ }\n`;
        output += `})\n`;
        output += `\nAvailable tools:\n`;
        output += toolNames.map((name) => `  • ${name}`).join("\n");
        output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      }

      output += `\nSTATUS: ${registry.size()} tools available via call_tool`;

      return {
        content: [{ type: "text" as const, text: output }],
        metadata: { toolNames, totalResults },
      };
    }, "Search failed")
  );

  return server;
}
