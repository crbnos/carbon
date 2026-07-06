export type Classification = "READ" | "WRITE" | "DESTRUCTIVE";

export interface CatalogTool {
  name: string;
  module: string;
  classification: Classification;
  description: string;
  paramCount: number;
}

export interface CatalogModule {
  key: string;
  label: string;
  description: string;
  count: number;
}

export interface McpCatalog {
  total: number;
  moduleCount: number;
  modules: CatalogModule[];
  tools: CatalogTool[];
}

const MODULE_META: Record<string, { label: string; description: string }> = {
  sales: { label: "Sales", description: "Quotes, orders, customers" },
  items: {
    label: "Items",
    description: "SKUs, inventory items, configurations"
  },
  production: {
    label: "Production",
    description: "Jobs, operations, scheduling"
  },
  purchasing: { label: "Purchasing", description: "POs, suppliers, receipts" },
  resources: { label: "Resources", description: "Machines, tools, labor" },
  settings: { label: "Settings", description: "Company config, tax, terms" },
  quality: { label: "Quality", description: "Inspections, testing, standards" },
  accounting: { label: "Accounting", description: "GL, journals, periods" },
  inventory: {
    label: "Inventory",
    description: "On-hand, movements, transfers"
  },
  people: { label: "People", description: "Employees, shifts, attendance" },
  shared: { label: "Shared", description: "Common cross-module operations" },
  invoicing: { label: "Invoicing", description: "Invoices, AR, payments" },
  users: { label: "Users", description: "User & permission management" },
  documents: { label: "Documents", description: "PDFs, attachments" },
  account: { label: "Account", description: "Profile & attributes" }
};

export interface RawToolMeta {
  tools: Array<{
    name: string;
    module: string;
    classification: string;
    description: string;
    paramCount: number;
  }>;
}

export function buildMcpCatalog(
  meta: RawToolMeta,
  blocked: readonly string[]
): McpCatalog {
  const blockedSet = new Set(blocked);
  const tools: CatalogTool[] = meta.tools
    .filter((t) => !blockedSet.has(t.name))
    .map((t) => ({
      name: t.name,
      module: t.module,
      classification: t.classification as Classification,
      description: t.description,
      paramCount: t.paramCount
    }));

  const counts = new Map<string, number>();
  for (const t of tools) counts.set(t.module, (counts.get(t.module) ?? 0) + 1);

  const modules: CatalogModule[] = [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: MODULE_META[key]?.label ?? key,
      description: MODULE_META[key]?.description ?? "",
      count
    }))
    .sort((a, b) => b.count - a.count);

  return { total: tools.length, moduleCount: modules.length, modules, tools };
}
