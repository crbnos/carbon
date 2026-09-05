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

/**
 * Display name for an operation: the callable name minus its `{module}_` prefix.
 * Every surface that shows an operation already states its module — the sidebar
 * groups by it, the detail page breadcrumbs it — so the prefix is redundant noise on
 * an already-long identifier. The FULL name stays wherever it is callable (the
 * `call_tool` snippet, the page title) since that is the string you actually send.
 */
export function operationLabel(name: string, moduleSlug: string): string {
  return name.startsWith(`${moduleSlug}_`)
    ? name.slice(moduleSlug.length + 1)
    : name;
}

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

export interface ToolCounts {
  /** Total number of operations across every module. */
  total: number;
  /** Number of modules. */
  modules: number;
  /** Operation count per classification. */
  byClass: Record<ToolClass, number>;
  /** `[module name, operation count]`, sorted by count descending. */
  perModule: [string, number][];
}

/** Counts derived from the generated catalog, so the docs copy can never go stale. */
export function toolCounts(): ToolCounts {
  const byClass: Record<ToolClass, number> = { READ: 0, WRITE: 0, DESTRUCTIVE: 0 };
  let total = 0;
  const perModule: [string, number][] = [];
  for (const m of toolModules) {
    total += m.tools.length;
    perModule.push([m.name, m.tools.length]);
    for (const t of m.tools) byClass[t.classification] += 1;
  }
  perModule.sort((a, b) => b[1] - a[1]);
  return { total, modules: toolModules.length, byClass, perModule };
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
