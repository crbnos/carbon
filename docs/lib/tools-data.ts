import raw from "./tools-data.generated";

export type ToolClass = "READ" | "WRITE" | "DESTRUCTIVE";

export interface ToolItem {
  name: string;
  slug: string;
  classification: ToolClass;
  description: string;
  schema: unknown;
}
export interface ToolModule {
  name: string;
  slug: string;
  module: string;
  tools: ToolItem[];
}
interface ToolData {
  modules: ToolModule[];
}

export const toolModules: ToolModule[] = (raw as ToolData).modules;

export function getTool(slug: string): { module: ToolModule; tool: ToolItem } | null {
  for (const m of toolModules) {
    const tool = m.tools.find((t) => t.slug === slug);
    if (tool) return { module: m, tool };
  }
  return null;
}

export function allToolParams(): { tool: string }[] {
  return toolModules.flatMap((m) => m.tools.map((t) => ({ tool: t.slug })));
}

// Slim nav tree (no schemas) for the sidebar.
export interface ToolNavItem {
  name: string;
  slug: string;
  classification: ToolClass;
}
export interface ToolNavModule {
  name: string;
  slug: string;
  tools: ToolNavItem[];
}
// Modules and their tools are listed alphabetically in the nav.
export const toolsNavTree: ToolNavModule[] = toolModules
  .map((m) => ({
    name: m.name,
    slug: m.slug,
    tools: m.tools
      .map((t) => ({ name: t.name, slug: t.slug, classification: t.classification }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
