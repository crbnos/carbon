import { pageSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { z } from "zod";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    // Optional `plan` frontmatter — when set (e.g. "Business"), the page template
    // renders a PlanBadge inline with the title to flag a paid-tier feature.
    schema: pageSchema.extend({
      plan: z.string().optional(),
    }),
  },
});

// The editorial Guide. Same MDX pipeline as the Reference, but each file is a
// chapter: `label` is its display marker (e.g. "(I)") and `index` orders the rail.
export const guide = defineDocs({
  dir: "content/guides",
  docs: {
    schema: pageSchema.extend({
      label: z.string(),
      index: z.number(),
      // Each chapter belongs to a flow (a self-contained tour). `flow` is the
      // stable id, `flowName` its display label, `flowIndex` orders the flows in
      // the subnav. Existing chapters default into the original make-to-order flow.
      flow: z.string().default("make-to-order"),
      flowName: z.string().default("Make to order"),
      flowIndex: z.number().default(0),
    }),
  },
});

// Remove <AgentContext> blocks from the MDX AST before fumadocs' remark-structure
// runs. AgentContext is agent-only: this keeps its content out of the rendered page
// AND out of the site search index (structuredData). The in-app agent still receives
// it — scripts/generate-agent-kb.ts reads the raw MDX source, not the compiled tree.
// fumadocs splices user remarkPlugins before remarkStructure, so this runs first.
function remarkStripAgentContext() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      node.children = node.children.filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (child: any) =>
          !(
            (child.type === "mdxJsxFlowElement" ||
              child.type === "mdxJsxTextElement") &&
            child.name === "AgentContext"
          )
      );
      for (const child of node.children) walk(child);
    };
    walk(tree);
  };
}

// Rewrite ```mermaid fences into <Mermaid chart="..."> before rehype sees them, so
// authors write plain markdown and shiki never tries to highlight a diagram (there is
// no "mermaid" grammar — it would fall through as unstyled text in a code panel).
// Runs on mdast, i.e. ahead of rehypeCode, and the <Mermaid> component is supplied by
// getMDXComponents like any other MDX component.
function remarkMermaid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = (node: any) => {
      if (!node || !Array.isArray(node.children)) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      node.children = node.children.map((child: any) => {
        if (child.type !== "code" || child.lang !== "mermaid") {
          walk(child);
          return child;
        }
        // `meta` after the language is used as the caption: ```mermaid The event chain
        const caption = typeof child.meta === "string" ? child.meta.trim() : "";
        return {
          type: "mdxJsxFlowElement",
          name: "Mermaid",
          attributes: [
            { type: "mdxJsxAttribute", name: "chart", value: child.value },
            ...(caption
              ? [{ type: "mdxJsxAttribute", name: "caption", value: caption }]
              : []),
          ],
          children: [],
        };
      });
    };
    walk(tree);
  };
}

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkStripAgentContext, remarkMermaid],
    // Dark code blocks everywhere, themed with Night Owl. Provide BOTH themes
    // explicitly (same theme) so fumadocs replaces its default github-light/github-dark-default
    // pair — a single `theme` leaves the default light theme referenced and shiki throws
    // "Theme `github-light` not found". Tokens then carry --shiki-light/--shiki-dark
    // vars, which the editorial code panel resolves to a color in reference.css.
    rehypeCodeOptions: {
      themes: { light: "github-dark-default", dark: "github-dark-default" },
      // Stamp the language onto the <pre> so the CodeBlock can show it as the header
      // label (Shiki strips the language otherwise). Fumadocs prepends our transformers
      // to its own (icon/meta), so this composes — it doesn't replace them.
      transformers: [
        {
          name: "carbon:data-language",
          pre(node) {
            const lang = this.options.lang;
            if (lang && lang !== "text" && lang !== "plaintext") {
              node.properties["data-language"] = lang;
            }
          },
        },
      ],
    },
  },
});
