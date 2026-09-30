import { tool } from "ai";
import { z } from "zod";
import {
  buttonBlock,
  choiceBlock,
  linkBlock,
  navigateBlock
} from "./agent.blocks";
import { readDoc, searchDocs } from "./agent.kb";
import { findPages, resolvePage } from "./agent.pages";

// The agent is READ-ONLY and docs-only: it answers from the product docs and can point
// the user at pages. It has no tool that reads or writes the customer's data.
export function createAgentTools() {
  return {
    search_docs: tool({
      description:
        "Search Carbon product documentation for how-to and conceptual answers. Returns matching sections: page title, section heading, a short snippet and a `url` (with #section). Answer from the snippets when they are enough; otherwise read_doc the url.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(10).optional()
      }),
      execute: async ({ query, limit }) => searchDocs({ query, limit })
    }),

    read_doc: tool({
      description:
        "Read documentation by the `url` search_docs returned. A url with #section returns just that section; a page url returns the page, or for a long page its intro and the section urls to read next.",
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => readDoc({ url })
    }),

    // UI blocks: the tool INPUT is the block the browser renders; the ack lets the model
    // continue.
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
    // Resolved here, not in the browser, so the model learns when a page can't be opened
    // instead of telling the user it took them somewhere. The browser goes to `url`.
    navigate: tool({
      description:
        "Take the user to a page found via find_page. Pass `key` (from find_page) and, if that page has arity > 0, `params` — the positional args it needs, in order (usually the id of the record the user is viewing, from the current page; never a made-up value). For an arity-0 page, omit params. Never invent a key; only use one find_page returned. Fires once.",
      inputSchema: navigateBlock,
      execute: async ({ key, params }) => {
        const url = resolvePage(key, params);
        return url
          ? { url }
          : {
              error:
                "That page could not be opened: unknown key or missing params. Use a key from find_page and pass the params its arity needs."
            };
      }
    })
  };
}
