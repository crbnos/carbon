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
import {
  formatMcpResult,
  MCP_DEFAULT_LIMIT,
  pageMcpListResult
} from "./format-result";
import { createCatalogSearch } from "./catalog-search";
import {
  deriveNameDescription,
  formatParamSummary,
  formatToolDescription,
  paginatingSibling
} from "./describe-format";
import { getServerInstructions } from "./instructions";

const logger = getLogger("erp", "mcp");

// One index for the process; createMcpServer runs per request.
const catalogSearch = createCatalogSearch(toolMetadata.tools);

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
      description: "Get the full contract for one or more tools: description, permission, input schema and response schema",
      inputSchema: z.object({
        name: z.string().optional().describe("The name of the tool to describe"),
        names: z
          .array(z.string())
          .max(10)
          .optional()
          .describe("Several tool names to describe in one call")
      }),
      annotations: READ_ONLY_ANNOTATIONS
    },
    withErrorHandling(async (params: any) => {
      const { name, names } = params;
      const requested: string[] = names?.length ? names : name ? [name] : [];

      logger.info("describe_tool invoked", { names: requested });

      if (requested.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: "Pass a tool `name` or a `names` array"
          }],
          isError: true
        };
      }

      const sections: string[] = [];
      const missing: string[] = [];
      for (const toolName of requested) {
        const meta = operationsByName.get(toolName);
        if (!meta) {
          missing.push(toolName);
          continue;
        }
        sections.push(
          formatToolDescription(meta, {
            isList: isListOperation(meta),
            sibling: meta.paginates
              ? null
              : paginatingSibling(meta.name, (n) => operationsByName.get(n))
          })
        );
      }

      if (missing.length > 0) {
        // A caller typo, not a server fault — warn, not error.
        logger.warn("Tool not found", { names: missing });
        sections.push(
          missing.map((toolName) => `Tool '${toolName}' not found`).join("\n")
        );
      }

      return {
        content: [{ type: "text" as const, text: sections.join("\n\n---\n\n") }],
        ...(missing.length === requested.length ? { isError: true } : {})
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
      // returned up to PostgREST's 1000-row cap). MCP-only; the other
      // callOperation callers (HTTP, agent, workflows) are untouched.
      // Two kinds of list service (manifest `paginates`):
      // - paginating (setGenericQueryFilters/.range): inject the PAIR — its
      //   `.range()` applies only when BOTH limit and offset are integers, so
      //   a bare `limit` silently paginated nothing.
      // - fetchAll (`get*List`): limit/offset are inert in the service, so the
      //   caller's paging is captured here and applied to the RESPONSE below —
      //   without this, `limit: 1` returned every row.
      const fillPagination = (target: Record<string, unknown>) => {
        if (target.limit === undefined) target.limit = MCP_DEFAULT_LIMIT;
        if (target.offset === undefined) target.offset = 0;
      };
      const meta = operationsByName.get(name);
      let mcpPaging: { limit: number; offset: number } | null = null;
      if (meta && isListOperation(meta)) {
        const body =
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : null;
        const wrapped =
          body?.args && typeof body.args === "object" && !Array.isArray(body.args)
            ? (body.args as Record<string, unknown>)
            : null;
        if (meta.paginates) {
          if (!body) {
            // The argless call is the worst offender — no limit at all.
            args = { limit: MCP_DEFAULT_LIMIT, offset: 0 };
          } else {
            fillPagination(wrapped ?? body);
          }
        } else {
          const source = wrapped ?? body ?? {};
          const limit = source.limit;
          const offset = source.offset;
          mcpPaging = {
            limit:
              Number.isInteger(limit) && (limit as number) > 0
                ? (limit as number)
                : MCP_DEFAULT_LIMIT,
            offset:
              Number.isInteger(offset) && (offset as number) >= 0
                ? (offset as number)
                : 0
          };
        }
      }

      // Runs through the canonical oRPC dispatch (gate middleware included); the
      // Supabase envelope arrives already unwrapped to `data`/`count`.
      const start = performance.now();
      const result = await callOperation(name, ctx, args);
      const responseTime = performance.now() - start;

      if (result.success) {
        logger.info("Execution result", {
          name,
          success: true,
          hasData: result.data !== undefined,
          responseTime
        });
        let output: string;
        if (result.data === undefined) {
          output = "Operation completed successfully";
        } else if (mcpPaging) {
          const { rows, total } = pageMcpListResult(result.data, mcpPaging);
          output = formatMcpResult(rows, total);
        } else {
          output = formatMcpResult(result.data, result.count);
        }
        return { content: [{ type: "text" as const, text: output }] };
      }
      logger.error("Tool execution failed", {
        name,
        error: result.error,
        errorKind: result.errorKind,
        responseTime
      });
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
      description: "Relevance-ranked search over ERP tools; understands common abbreviations (PO, RMA, BOM, NCR) and matches schema field names too",
      inputSchema: z.object({
        query: z.string().optional().describe("Keywords to match against tool names, descriptions and schema field names"),
        module: z.string().optional().describe("Filter by module name"),
        classification: z.enum(["READ", "WRITE", "DESTRUCTIVE"]).optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0)
      }),
      annotations: READ_ONLY_ANNOTATIONS
    },
    withErrorHandling(async (params: any) => {
      const { query, module, classification, limit = 20, offset = 0 } = params;

      // BM25-ranked with alias expansion (see catalog-search.ts); filter-only
      // calls keep metadata order.
      const { matches, total } = await catalogSearch.search({
        query,
        module,
        classification,
        limit,
        offset
      });
      const toolNames = matches.map(t => t.name);

      logger.info("search_tools invoked", {
        query,
        module,
        classification,
        limit,
        offset,
        matched: total,
        returned: toolNames.length
      });

      // Build response
      let output = `Found ${total} tools`;
      if (total > limit) {
        output += ` (showing ${offset + 1}-${offset + matches.length}, ranked by relevance)`;
      }
      output += ":\n\n";

      // Group by module, preserving the ranked order within each group
      const byModule = new Map<string, typeof matches>();
      for (const tool of matches) {
        if (!byModule.has(tool.module)) {
          byModule.set(tool.module, []);
        }
        byModule.get(tool.module)!.push(tool);
      }

      // One line per tool: required args inline so simple tools need no
      // describe round trip; the description only when it says more than the
      // name does (today that means a hand-written override).
      for (const [mod, tools] of byModule.entries()) {
        output += `${mod.toUpperCase()} MODULE:\n`;

        for (const tool of tools) {
          output += `  • ${tool.name} [${tool.classification}] ${formatParamSummary(tool)}\n`;
          if (tool.description !== deriveNameDescription(tool.name)) {
            output += `    ${tool.description}\n`;
          }
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
          totalResults: total
        }
      };
    }, "Search failed")
  );

  return server;
}