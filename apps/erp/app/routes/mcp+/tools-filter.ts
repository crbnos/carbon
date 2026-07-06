import type { CatalogTool } from "./catalog";

export interface ToolFilter {
  q: string;
  module: string;
  classification: string;
}

export function filterTools(
  tools: CatalogTool[],
  f: ToolFilter
): CatalogTool[] {
  const q = f.q.trim().toLowerCase();
  return tools.filter((t) => {
    if (f.module && t.module !== f.module) return false;
    if (f.classification && t.classification !== f.classification) return false;
    if (q && !`${t.name} ${t.description}`.toLowerCase().includes(q))
      return false;
    return true;
  });
}
