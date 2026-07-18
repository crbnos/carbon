import { tool } from "ai";
import { z } from "zod";
import {
  type ExecutorContext,
  executeFunction
} from "~/routes/api+/mcp+/lib/direct-executor";
import { isMcpBlockedTool } from "~/routes/api+/mcp+/lib/mcp-blocked-tools";
import toolMetadata from "~/routes/api+/mcp+/lib/tool-metadata.json";
import { readDoc, searchDocs } from "./agent.kb";

// v1 is READ-ONLY. The safety guarantee lives here, once: the agent can only see and
// call tools in this READ-classified index. A non-READ or unknown name simply isn't in
// it, so "unavailable" falls out of the lookup — there's no separate guard to keep in
// sync across tools. v2 replaces this index with an approval gate.
const readTools = toolMetadata.tools.filter((t) => t.classification === "READ");
const readToolByName = new Map(readTools.map((t) => [t.name, t]));

export function createAgentTools(ctx: ExecutorContext) {
  return {
    search_docs: tool({
      description:
        "Search Carbon product documentation for how-to and conceptual answers. Returns matching doc slugs.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(10).optional()
      }),
      execute: async ({ query, limit }) => searchDocs({ query, limit })
    }),

    read_doc: tool({
      description:
        "Read the full markdown of a documentation page by its URL (the `url` returned by search_docs).",
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => readDoc({ url })
    }),

    search_tools: tool({
      description:
        "Discover READ-only ERP tools by keyword and/or module (e.g. sales, inventory, production).",
      inputSchema: z.object({
        query: z.string().optional(),
        module: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().min(0).optional()
      }),
      execute: async ({ query, module, limit = 20, offset = 0 }) => {
        let results = readTools;
        if (module) {
          const m = module.toLowerCase();
          results = results.filter((t) => t.module.toLowerCase().includes(m));
        }
        if (query) {
          const q = query.toLowerCase();
          results = results.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.description.toLowerCase().includes(q) ||
              t.module.toLowerCase().includes(q)
          );
        }
        const page = results.slice(offset, offset + limit);
        return {
          total: results.length,
          tools: page.map((t) => ({
            name: t.name,
            module: t.module,
            description: t.description
          }))
        };
      }
    }),

    describe_tool: tool({
      description:
        "Get the input schema and description for a specific tool before calling it.",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const t = readToolByName.get(name);
        if (!t) return { error: `Tool "${name}" is not available.` };
        return {
          name: t.name,
          module: t.module,
          description: t.description,
          schema: t.schema
        };
      }
    }),

    call_tool: tool({
      description:
        "Execute a READ-only ERP tool by name. companyId/userId are injected automatically.",
      inputSchema: z.object({
        name: z.string(),
        arguments: z.any().optional()
      }),
      execute: async ({ name, arguments: args }) => {
        // Not in the READ index (unknown or non-READ) → unavailable, no separate guard.
        if (!readToolByName.has(name) || isMcpBlockedTool(name)) {
          return { error: `Tool "${name}" is not available.` };
        }
        return executeFunction(
          name,
          ctx,
          args as Record<string, unknown> | undefined
        );
      }
    })
  };
}
