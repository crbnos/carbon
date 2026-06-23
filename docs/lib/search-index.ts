import "server-only";
import type { AdvancedIndex } from "fumadocs-core/search/server";
import { apiModules } from "@/lib/api-data";
import { glossaryEntries, termSlug } from "@carbon/glossary";
import { guideSource, source } from "@/lib/source";
import { toolModules } from "@/lib/tools-data";

const GLOSSARY_URL = "/docs/glossary";

/* One Orama index over all four doc surfaces. Each entry is `tag`ged so the single
 * /api/search endpoint can be filtered per surface (the header's All/Guide/Reference/
 * API/MCP pills map to these tags). MDX pages reuse the `structuredData` the
 * fumadocs-mdx pipeline already produces (the same field createFromSource read); the
 * generated API/MCP data is shaped into structuredData by hand so column- and
 * parameter-level matches still land the right page. */

type StructuredData = AdvancedIndex["structuredData"];

// Structural shape shared by both MDX loaders' pages — enough to index, no more.
interface IndexablePage {
  url: string;
  data: { title?: string; description?: string; structuredData?: StructuredData };
}

function mdxIndexes(pages: IndexablePage[], tag: string, crumb: string): AdvancedIndex[] {
  return pages.map((page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title ?? page.url,
    description: page.data.description,
    tag,
    breadcrumbs: [crumb],
    structuredData: page.data.structuredData ?? { headings: [], contents: [] },
  }));
}

function toolParamNames(schema: unknown): string[] {
  if (schema && typeof schema === "object" && "properties" in schema) {
    const props = (schema as { properties?: unknown }).properties;
    if (props && typeof props === "object") return Object.keys(props as Record<string, unknown>);
  }
  return [];
}

function toolIndexes(): AdvancedIndex[] {
  return toolModules.flatMap((mod) =>
    mod.tools.map((tool) => {
      const params = toolParamNames(tool.schema);
      const contents: StructuredData["contents"] = [
        {
          heading: undefined,
          content: `${tool.description}. ${tool.classification} tool in the ${mod.name} module.`,
        },
      ];
      if (params.length) {
        contents.push({ heading: undefined, content: `Parameters: ${params.join(", ")}.` });
      }
      return {
        id: `/mcp/tools/${tool.slug}`,
        url: `/mcp/tools/${tool.slug}`,
        title: tool.name,
        description: tool.description,
        tag: "tools",
        breadcrumbs: ["MCP", mod.name],
        structuredData: { headings: [], contents },
      };
    }),
  );
}

function resourceIndexes(): AdvancedIndex[] {
  return apiModules.flatMap((mod) =>
    mod.resources.map((r) => {
      // Endpoint titles become headings whose ids match the page's <section id> anchors,
      // so a heading hit deep-links straight to "List customers" etc.
      const headings: StructuredData["headings"] = r.endpoints.map((e) => ({
        id: e.id,
        content: e.title,
      }));
      // Every field name across the resource's endpoints — a search for a column lands here.
      const fields = Array.from(
        new Set(r.endpoints.flatMap((e) => e.attributes.map((a) => a.name))),
      );
      const contents: StructuredData["contents"] = [
        {
          heading: undefined,
          content: `The ${r.name} ${r.kind} (${r.table}) in the ${mod.name} module.`,
        },
        ...r.endpoints.map((e) => ({
          heading: e.title,
          content: `${e.method} ${e.path} — ${e.description}`,
        })),
      ];
      if (fields.length) {
        contents.push({ heading: undefined, content: `Fields: ${fields.join(", ")}.` });
      }
      return {
        id: `/api-reference/${mod.slug}/${r.slug}`,
        url: `/api-reference/${mod.slug}/${r.slug}`,
        title: r.name,
        description: r.description,
        tag: "resources",
        breadcrumbs: ["API", mod.name],
        structuredData: { headings, contents },
      };
    }),
  );
}

/* The Glossary page renders its terms through the <Glossary> React component, so the
 * MDX pipeline's structuredData captures only the page intro. Build the term index by
 * hand from lib/glossary.ts: every term becomes a heading (id = its row anchor, so a hit
 * deep-links to the term) and its definition the content. */
function glossaryIndex(page: IndexablePage): AdvancedIndex {
  const entries = glossaryEntries();
  return {
    id: page.url,
    url: page.url,
    title: page.data.title ?? "Glossary",
    description: page.data.description,
    tag: "docs",
    breadcrumbs: ["Glossary"],
    structuredData: {
      headings: entries.map((e) => ({ id: termSlug(e.term), content: e.term })),
      contents: entries.map((e) => ({ heading: termSlug(e.term), content: e.definition })),
    },
  };
}

export function buildSearchIndexes(): AdvancedIndex[] {
  const docsPages = source.getPages() as IndexablePage[];
  const glossaryPage = docsPages.find((p) => p.url === GLOSSARY_URL);
  const otherDocs = docsPages.filter((p) => p.url !== GLOSSARY_URL);

  return [
    ...mdxIndexes(otherDocs, "docs", "Reference"),
    ...(glossaryPage ? [glossaryIndex(glossaryPage)] : []),
    ...mdxIndexes(guideSource.getPages(), "guide", "Guide"),
    ...resourceIndexes(),
    ...toolIndexes(),
  ];
}
