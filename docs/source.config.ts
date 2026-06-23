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

export default defineConfig({
  mdxOptions: {
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
