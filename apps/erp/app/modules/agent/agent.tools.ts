import { tool } from "ai";
import { z } from "zod";
import {
  type ExecutorContext,
  executeFunction
} from "~/routes/api+/mcp+/lib/direct-executor";
import { isMcpBlockedTool } from "~/routes/api+/mcp+/lib/mcp-blocked-tools";
import toolMetadata from "~/routes/api+/mcp+/lib/tool-metadata.json";
import {
  buttonBlock,
  choiceBlock,
  linkBlock,
  navigateBlock
} from "./agent.blocks";
import { AGENT_DATA_TOOLS_ENABLED } from "./agent.config";
import { readDoc, searchDocs } from "./agent.kb";
import { findPages } from "./agent.pages";

// v1 is READ-ONLY. The safety guarantee lives here, once: the agent can only see and
// call tools in this READ-classified index. A non-READ or unknown name simply isn't in
// it, so "unavailable" falls out of the lookup — there's no separate guard to keep in
// sync across tools. v2 replaces this index with an approval gate.
const readTools = toolMetadata.tools.filter((t) => t.classification === "READ");
const readToolByName = new Map(readTools.map((t) => [t.name, t]));

export function createAgentTools(ctx: ExecutorContext) {
  // v1 is docs-only (see agent.config.ts): the live-data tools are wired up but gated
  // off. When disabled they're simply omitted from the tool set, so the model never
  // sees them and can't fan out large row payloads into context.
  const dataTools = AGENT_DATA_TOOLS_ENABLED ? createDataTools(ctx) : {};

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

    ...dataTools,

    // UI-block tools — presentation only (no data touched), safe in read-only v1.
    // The tool INPUT is the block the client renders; the ack lets the model continue.
    present_choice: tool({
      description:
        "Ask the user to pick from a set of options. Use when you need the user to choose or disambiguate. Call this as your final action; the user's pick arrives as their next message. Do not add text after it.",
      inputSchema: choiceBlock,
      execute: async () => ({ shown: true })
    }),
    present_link: tool({
      description:
        "Show a labelled link the user can open (a Carbon record page or a docs URL).",
      inputSchema: linkBlock,
      execute: async () => ({ shown: true })
    }),
    present_button: tool({
      description:
        "Show a single suggested action button. When clicked it sends `message` as the user's next message.",
      inputSchema: buttonBlock,
      execute: async () => ({ shown: true })
    }),
    find_page: tool({
      description:
        "Find an app page to send the user to. Query by what the user wants (e.g. 'getting started', 'jobs', 'settings', 'a specific part'). Returns candidate pages, each with a `key`, a label, a sample `url`, and `arity` (how many args it needs — usually 1 id for a record page, 0 for a list/module page). Pick the best `key`, then call navigate.",
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => ({ pages: findPages(query) })
    }),
    navigate: tool({
      description:
        "Take the user to a page found via find_page. Pass `key` (from find_page) and, if that page has arity > 0, `params` — the positional args it needs, in order (usually one record id you looked up with a read tool, NOT a made-up value). For an arity-0 page, omit params. Never invent a key; only use one find_page returned. Fires once.",
      inputSchema: navigateBlock,
      execute: async () => ({ navigated: true })
    })
  };
}

// Live-data ERP tools. Gated behind AGENT_DATA_TOOLS_ENABLED (off in v1). Kept intact
// so the agent-with-actions milestone can re-enable them behind an enforcement gate.
function createDataTools(ctx: ExecutorContext) {
  return {
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
