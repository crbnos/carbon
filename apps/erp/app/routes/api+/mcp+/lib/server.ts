// @ts-nocheck
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./types";
import { z } from "zod";
import { withErrorHandling, READ_ONLY_ANNOTATIONS, WRITE_ANNOTATIONS } from "./types";
import toolMetadata from "./tool-metadata.json";
import { isMcpBlockedTool } from "./mcp-blocked-tools";
import { executeFunction } from "./direct-executor";

function getServerInstructions(): string {
  const today = new Date().toISOString().split("T")[0];
  
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
- Dates: ISO 8601 (YYYY-MM-DD)
- Pagination: limit/offset`;
}

export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    {
      name: "carbon-erp",
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "1.0.0",
    },
    {
      instructions: getServerInstructions(),
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
      
      console.log("[MCP Server] describe_tool invoked for:", name);
      
      // Find the tool in metadata
      const tool = toolMetadata.tools.find(t => t.name === name);
      if (!tool) {
        console.error("[MCP Server] Tool not found:", name);
        return {
          content: [{ type: "text" as const, text: `Tool '${name}' not found` }],
          isError: true
        };
      }
      
      console.log("[MCP Server] Found tool:", tool.name, "in module:", tool.module);
      
      // Tool schemas are provided via metadata, no need to load modules
      
      let output = `Tool: ${name}\n`;
      output += `Module: ${tool.module}\n`;
      output += `Classification: ${tool.classification}\n`;
      output += `Description: ${tool.description}\n\n`;
      
      output += `Input Schema:\n`;
      output += JSON.stringify(tool.schema || {}, null, 2);
      
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
      
      console.log("[MCP Server] call_tool invoked:", { name, arguments: args });

      if (isMcpBlockedTool(name)) {
        return {
          content: [{
            type: "text" as const,
            text: `Tool disabled: ${name} is not available via MCP.`
          }],
          isError: true
        };
      }
      
      // Use direct executor instead of MCP protocol
      const result = await executeFunction(name, ctx, args);
      
      console.log("[MCP Server] Execution result:", {
        success: result.success,
        hasData: !!result.data,
        error: result.error
      });
      
      if (result.success) {
        // Format successful response
        let output = "";
        
        // Check if the result.data is a Supabase response format
        if (result.data && typeof result.data === 'object' && 'data' in result.data) {
          // Supabase format: { data: [...], error: null, count: ... }
          const supabaseData = result.data.data;
          console.log("[MCP Server] Detected Supabase response format");
          console.log("[MCP Server] Data array length:", Array.isArray(supabaseData) ? supabaseData.length : 'not array');
          
          if (result.data.error) {
            console.error("[MCP Server] Supabase error:", result.data.error);
            return {
              content: [{ type: "text" as const, text: `Database error: ${JSON.stringify(result.data.error)}` }],
              isError: true
            };
          }
          
          output = JSON.stringify(supabaseData, null, 2);
        } else if (result.data) {
          output = JSON.stringify(result.data, null, 2);
          console.log("[MCP Server] Using result.data for output");
        } else {
          output = "Operation completed successfully";
          console.log("[MCP Server] No data in result, using default message");
        }
        
        console.log("[MCP Server] Returning output (truncated):", output.substring(0, 200));
        
        return {
          content: [{ type: "text" as const, text: output }]
        };
      } else {
        console.error("[MCP Server] Tool execution failed:", result.error);
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true
        };
      }
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
      
      console.log("[MCP Server] search_tools invoked:", { query, module, classification, limit, offset });
      
      let results = toolMetadata.tools;
      console.log("[MCP Server] Total tools available:", results.length);
      
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
      
      console.log("[MCP Server] Found tools after filtering:", results.length);
      console.log("[MCP Server] Returning tools:", toolNames);
      
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
      
      // Add instructions for using call_tool
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
        output += toolNames.map(name => `  • ${name}`).join('\n');
        output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      }
      
      output += `\nSTATUS: ${toolMetadata.totalTools} tools available via call_tool`;
      
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