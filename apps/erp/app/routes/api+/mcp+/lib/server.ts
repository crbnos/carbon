// MCP server. Tool metadata is read from the build-time-generated
// `mcp-tools.json`; execution dispatches through `direct-executor.ts` which
// resolves the service function via a static-import map.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import toolMetadata from "~/services/mcp/mcp-tools.json";
import { executeFunction } from "./direct-executor";
import type { McpContext } from "./types";
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  withErrorHandling
} from "./types";

interface ToolMeta {
  id: string;
  module: string;
  name: string;
  description: string;
  classification: "READ" | "WRITE" | "DESTRUCTIVE";
  serviceParams: string[];
  injectAuth: string[];
  injectInto?: string;
  disable: boolean;
}

const TOOLS: ToolMeta[] = (toolMetadata.tools as ToolMeta[]).filter(
  (t) => !t.disable
);

const TOOLS_BY_NAME: Map<string, ToolMeta> = new Map(
  TOOLS.map((t) => [t.id, t])
);

const MODULE_COUNT = new Set(TOOLS.map((t) => t.module)).size;

function getServerInstructions(): string {
  const today = new Date().toISOString().split("T")[0];
  return `Carbon ERP Manufacturing System
==========================================
Date: ${today}

IMPORTANT: Tool Discovery System
This server has ${TOOLS.length} tools available across ${MODULE_COUNT} modules.

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
  const server = new McpServer(
    {
      name: "carbon-erp",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "1.0.0"
    },
    { instructions: getServerInstructions() }
  );

  server.registerTool(
    "describe_tool",
    {
      description: "Get the schema and description for a specific tool",
      inputSchema: z.object({
        name: z.string().describe("The name of the tool to describe")
      }),
      annotations: READ_ONLY_ANNOTATIONS
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK params untyped
    withErrorHandling(async (params: any) => {
      const tool = TOOLS_BY_NAME.get(params.name);
      if (!tool) {
        return {
          content: [
            { type: "text" as const, text: `Tool '${params.name}' not found` }
          ],
          isError: true
        };
      }

      let output = `Tool: ${tool.id}\n`;
      output += `Module: ${tool.module}\n`;
      output += `Classification: ${tool.classification}\n`;
      output += `Description: ${tool.description}\n`;
      if (tool.serviceParams.length > 0) {
        output += `Service params: ${tool.serviceParams.join(", ")}\n`;
      }
      if (tool.injectAuth.length > 0) {
        const target = tool.injectInto ? ` into "${tool.injectInto}"` : "";
        output += `Auto-injected${target}: ${tool.injectAuth.join(", ")}\n`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    }, "Describe tool failed")
  );

  server.registerTool(
    "call_tool",
    {
      description: "Call any ERP tool by name with the specified parameters",
      inputSchema: z.object({
        name: z.string().describe("The name of the tool to call"),
        arguments: z.any().describe("The arguments to pass to the tool")
      }),
      annotations: WRITE_ANNOTATIONS
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK params untyped
    withErrorHandling(async (params: any) => {
      const { name, arguments: rawArgs } = params;
      let args = rawArgs;

      if (typeof args === "string") {
        try {
          args = args.trim().length > 0 ? JSON.parse(args) : {};
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Invalid JSON in call_tool.arguments"
              }
            ],
            isError: true
          };
        }
      }

      if (
        process.env.NODE_ENV !== "production" ||
        process.env.MCP_DEBUG === "1"
      ) {
        console.log("[MCP Server] call_tool invoked:", {
          name,
          arguments: args
        });
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
                {
                  type: "text" as const,
                  text: `Database error: ${JSON.stringify(result.data.error)}`
                }
              ],
              isError: true
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
        isError: true
      };
    }, "Call tool failed")
  );

  server.registerTool(
    "search_tools",
    {
      description: "Search for ERP tools by name, description, or module",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe("Search in tool names/descriptions"),
        module: z.string().optional().describe("Filter by module name"),
        classification: z.enum(["READ", "WRITE", "DESTRUCTIVE"]).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0)
      }),
      annotations: READ_ONLY_ANNOTATIONS
    },
    // biome-ignore lint/suspicious/noExplicitAny: MCP SDK params untyped
    withErrorHandling(async (params: any) => {
      const { query, module, classification, limit = 20, offset = 0 } = params;

      let results: ToolMeta[] = TOOLS;
      if (module) {
        const m = module.toLowerCase();
        results = results.filter((t) => t.module.toLowerCase().includes(m));
      }
      if (classification) {
        results = results.filter((t) => t.classification === classification);
      }
      if (typeof query === "string" && query.trim().length > 0) {
        const q = query.trim().toLowerCase();
        results = results.filter(
          (t) =>
            t.id.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q) ||
            t.module.toLowerCase().includes(q)
        );
      }

      const totalResults = results.length;
      const rows = results.slice(offset, offset + limit);
      const toolNames = rows.map((t) => t.id);

      let output = `Found ${totalResults} tools`;
      if (totalResults > limit) {
        output += ` (showing ${offset + 1}-${offset + rows.length})`;
      }
      output += ":\n\n";

      const byModule = new Map<string, ToolMeta[]>();
      for (const tool of rows) {
        if (!byModule.has(tool.module)) byModule.set(tool.module, []);
        byModule.get(tool.module)!.push(tool);
      }

      for (const [mod, tools] of byModule.entries()) {
        output += `${mod.toUpperCase()} MODULE:\n`;
        for (const tool of tools) {
          output += `  • ${tool.id} [${tool.classification}]\n`;
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

      output += `\nSTATUS: ${TOOLS.length} tools available via call_tool`;

      return {
        content: [{ type: "text" as const, text: output }],
        metadata: { toolNames, totalResults }
      };
    }, "Search failed")
  );

  return server;
}
