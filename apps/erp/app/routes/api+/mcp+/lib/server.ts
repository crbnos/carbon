// @ts-nocheck
import { getLogger } from "@carbon/logger";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./types";
import { z } from "zod";
import { withErrorHandling, READ_ONLY_ANNOTATIONS, WRITE_ANNOTATIONS } from "./types";
import toolMetadata from "./tool-metadata.json";
import { isMcpBlockedTool } from "./mcp-blocked-tools";
import { callOperation } from "../../v1+/lib/call.server";
import {
  isListOperation,
  operationsByName
} from "../../v1+/lib/operations.server";
import { formatMcpResult, MCP_DEFAULT_LIMIT } from "./format-result";

const logger = getLogger("erp", "mcp");

function getServerInstructions(today: string): string {

  return `Carbon ERP Manufacturing System
==========================================
Date: ${today}

IMPORTANT: Tool Discovery System
This server has ${toolMetadata.totalTools} tools available across ${toolMetadata.modules} modules.

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
- Results omit null fields — an absent field means null
- List reads default to 25 rows; pass limit/offset to page
- Dates: ISO 8601 (YYYY-MM-DD)
- Pagination: limit/offset`;
}

export function createMcpServer(ctx: McpContext, today: string): McpServer {
  const server = new McpServer(
    {
      name: "carbon-erp",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "1.0.0",
    },
    {
      instructions: getServerInstructions(today),
    },
  );


  // Register describe_tool to get schema information for any tool
  server.registerTool(
    "describe_tool",
    {
      description: "Get the schema and description for a specific tool",
      inputSchema: z.object({
        name: z.string().describe("The name of the tool to describe")
      }),
      annotations: READ_ONLY_ANNOTATIONS
    },
    withErrorHandling(async (params: any) => {
      const { name } = params;
      
      logger.info("describe_tool invoked", { name });

      // Find the tool in metadata
      const tool = toolMetadata.tools.find(t => t.name === name);
      if (!tool) {
        logger.error("Tool not found", { name });
        return {
          content: [{ type: "text" as const, text: `Tool '${name}' not found` }],
          isError: true
        };
      }

      logger.info("Found tool", { name: tool.name, module: tool.module });
      
      // Tool schemas are provided via metadata, no need to load modules
      
      let output = `Tool: ${name}\n`;
      output += `Module: ${tool.module}\n`;
      output += `Classification: ${tool.classification}\n`;
      output += `Description: ${tool.description}\n\n`;
      
      // Compact on purpose — pretty-printing roughly doubles the whitespace
      // tokens of a schema, and models parse compact JSON just as well.
      output += `Input Schema:\n`;
      output += JSON.stringify(tool.schema || {});
      
      return {
        content: [{ type: "text" as const, text: output }]
      };
    }, "Describe tool failed")
  );

  // Register call_tool with direct execution
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
    withErrorHandling(async (params: any) => {
      const { name, arguments: rawArgs } = params;
      let args = rawArgs;

      // Some MCP clients send arguments as a JSON string; normalize to object.
      if (typeof args === "string") {
        try {
          args = args.trim().length > 0 ? JSON.parse(args) : {};
        } catch {
          return {
            content: [{ type: "text" as const, text: "Invalid JSON in call_tool.arguments" }],
            isError: true
          };
        }
      }
      
      logger.info("call_tool invoked", { name, arguments: args });

      if (isMcpBlockedTool(name)) {
        return {
          content: [{
            type: "text" as const,
            text: `Tool disabled: ${name} is not available via MCP.`
          }],
          isError: true
        };
      }
      
      // List reads apply no limit unless the caller passes one (the schema's
      // `default: 100` is documentation, not enforcement — an argless call
      // returned up to PostgREST's 1000-row cap). Inject a modest default so
      // agents page deliberately; MCP-only, the other callOperation callers
      // (HTTP, agent, workflows) are untouched. Unknown keys are inert for
      // list-shaped ops that don't page, so injecting unconditionally is safe.
      // setGenericQueryFilters applies its `.range()` only when BOTH limit and
      // offset are integers, so the pair is always filled together — a bare
      // `limit` (injected OR caller-supplied) would silently paginate nothing.
      const fillPagination = (target: Record<string, unknown>) => {
        if (target.limit === undefined) target.limit = MCP_DEFAULT_LIMIT;
        if (target.offset === undefined) target.offset = 0;
      };
      const meta = operationsByName.get(name);
      if (meta && isListOperation(meta)) {
        if (args === undefined || args === null) {
          // The argless call is the worst offender — no limit at all.
          args = { limit: MCP_DEFAULT_LIMIT, offset: 0 };
        } else if (typeof args === "object" && !Array.isArray(args)) {
          const body = args as Record<string, unknown>;
          const wrapped = body.args;
          if (
            wrapped &&
            typeof wrapped === "object" &&
            !Array.isArray(wrapped)
          ) {
            fillPagination(wrapped as Record<string, unknown>);
          } else {
            fillPagination(body);
          }
        }
      }

      // Runs through the canonical oRPC dispatch (gate middleware included); the
      // Supabase envelope arrives already unwrapped to `data`/`count`.
      const result = await callOperation(name, ctx, args);

      logger.info("Execution result", {
        success: result.success,
        hasData: result.success && result.data !== undefined,
        error: result.success ? undefined : result.error
      });

      if (result.success) {
        const output =
          result.data === undefined
            ? "Operation completed successfully"
            : formatMcpResult(result.data, result.count);
        return { content: [{ type: "text" as const, text: output }] };
      }
      logger.error("Tool execution failed", { error: result.error });
      return {
        content: [{
          type: "text" as const,
          text: result.errorKind === "database" ? result.error : `Error: ${result.error}`
        }],
        isError: true
      };
    }, "Call tool failed")
  );

  // Register search_tools for discovery
  server.registerTool(
    "search_tools",
    {
      description: "Search for ERP tools and automatically make them available for use",
      inputSchema: z.object({
        query: z.string().optional().describe("Search in tool names/descriptions"),
        module: z.string().optional().describe("Filter by module name"),
        classification: z.enum(["READ", "WRITE", "DESTRUCTIVE"]).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0)
      }),
      annotations: READ_ONLY_ANNOTATIONS
    },
    withErrorHandling(async (params: any) => {
      const { query, module, classification, limit = 20, offset = 0 } = params;
      
      logger.info("search_tools invoked", { query, module, classification, limit, offset });

      let results = toolMetadata.tools;
      logger.info("Total tools available", { count: results.length });
      
      // Apply filters
      if (module) {
        results = results.filter(t => t.module.toLowerCase().includes(module.toLowerCase()));
      }
      if (classification) {
        results = results.filter(t => t.classification === classification);
      }
      if (query) {
        const q = query.toLowerCase();
        results = results.filter(t => 
          t.name.toLowerCase().includes(q) || 
          t.description.toLowerCase().includes(q) ||
          t.module.toLowerCase().includes(q)
        );
      }
      
      const foundTools = results.slice(offset, offset + limit);
      const toolNames = foundTools.map(t => t.name);
      
      logger.info("Found tools after filtering", { count: results.length });
      logger.info("Returning tools", { toolNames });
      
      // Build response
      let output = `Found ${results.length} tools`;
      if (results.length > limit) {
        output += ` (showing ${offset + 1}-${offset + foundTools.length})`;
      }
      output += ":\n\n";
      
      // Group by module
      const byModule = new Map<string, typeof foundTools>();
      for (const tool of foundTools) {
        if (!byModule.has(tool.module)) {
          byModule.set(tool.module, []);
        }
        byModule.get(tool.module)!.push(tool);
      }
      
      // Format results
      for (const [mod, tools] of byModule.entries()) {
        output += `${mod.toUpperCase()} MODULE:\n`;
        
        for (const tool of tools) {
          output += `  • ${tool.name} [${tool.classification}]\n`;
          output += `    ${tool.description}\n`;
        }
        output += "\n";
      }
      
      // No usage footer: the describe_tool/call_tool how-to ships once in the
      // server instructions at connect, and re-listing the names duplicated
      // the grouped list above on every search.
      output += `STATUS: ${toolMetadata.totalTools} tools available via call_tool`;
      
      return {
        content: [{ type: "text" as const, text: output }],
        metadata: {
          toolNames,
          totalResults: results.length
        }
      };
    }, "Search failed")
  );

  return server;
}