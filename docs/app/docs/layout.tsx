import type { ReactNode } from "react";
import { DocsNav, type DocsNavNode } from "@/components/api/docs-nav";
import { TableOfContents } from "@/components/api/toc";
import { MainHeader } from "@/components/main-header";
import { NavScrollChevron } from "@/components/nav-scroll-chevron";
import { PlanBannerBar } from "@/components/plan-banner-bar";
import { ScrollHints } from "@/components/scroll-hints";
import { source } from "@/lib/source";
import "../reference.css";

type TreeNode = {
  type: "page" | "folder" | "separator";
  name?: unknown;
  url?: string;
  index?: { url?: string };
  children?: TreeNode[];
};

const label = (name: unknown) =>
  typeof name === "string" ? name : String(name ?? "");

/** Convert the Fumadocs page tree into our serializable nav shape. Order is the page
 *  tree's own order — i.e. each folder's meta.json `pages` array — so every section
 *  can be curated there. (An earlier version alphabetized folder children, which made
 *  meta.json ordering dead weight.) */
function toNav(nodes: TreeNode[]): DocsNavNode[] {
  return nodes.flatMap((n) => {
    if (n.type === "separator") return [];
    if (n.type === "folder") {
      return [
        {
          label: label(n.name),
          url: n.index?.url,
          children: toNav(n.children ?? []),
        },
      ];
    }
    return [{ label: label(n.name), url: n.url }];
  });
}

// The Product-reference list is long and flat; nest it under Carbon modules so the rail
// stays scannable. Grouped by URL *slug* — purely a sidebar view, so the underlying page
// URLs (/docs/reference/<slug>) never move. Any reference page missing from this map is
// appended ungrouped, so adding a new entity can never make it vanish from the nav.
const REFERENCE_GROUPS: { label: string; slugs: string[] }[] = [
  { label: "Getting started", slugs: ["onboarding"] },
  {
    label: "Sales",
    slugs: ["quotes", "pricing", "sales-orders", "rmas", "customer-portal"],
  },
  {
    label: "Items & engineering",
    slugs: [
      "items",
      "materials",
      "methods",
      "routings",
      "configurator",
      "change-orders",
    ],
  },
  { label: "Planning", slugs: ["planning", "forecast", "reordering"] },
  {
    label: "Purchasing",
    slugs: [
      "purchase-orders",
      "supplier-returns",
      "supplier-quotes",
      "suppliers-and-customers",
    ],
  },
  {
    label: "Production",
    slugs: [
      "jobs",
      "scheduling",
      "batching",
      "kanban",
      "work-centers",
      "maintenance",
      "mes",
    ],
  },
  {
    label: "Inventory",
    slugs: [
      "inventory",
      "inventory-count",
      "storage-rules",
      "shelf-life",
      "scrap",
      "traceability",
    ],
  },
  { label: "Fulfillment", slugs: ["picking", "shipments", "receipts"] },
  {
    label: "Quality",
    slugs: [
      "quality",
      "inspections",
      "issues",
      "calibration",
      "quality-documents",
      "risks",
    ],
  },
  { label: "Invoicing & payments", slugs: ["invoices", "payments"] },
  {
    label: "Accounting",
    slugs: [
      "accounting",
      "financial-reports",
      "period-close",
      "dimensions",
      "intercompany",
      "fixed-assets",
    ],
  },
  {
    label: "People & access",
    slugs: [
      "people",
      "training",
      "permissions",
      "two-factor",
      "single-sign-on",
      "account",
    ],
  },
  {
    label: "Automation & alerts",
    slugs: ["workflows", "approvals", "notifications"],
  },
  {
    label: "Administration",
    slugs: [
      "company-settings",
      "sequences",
      "custom-fields",
      "documents",
      "printing",
      "import-export",
      "audit-log",
      "sharing",
      "agent",
    ],
  },
];

const slugOf = (url?: string) => url?.split("/").filter(Boolean).pop() ?? "";

/** Nest the flat Product-reference group's pages under module sub-groups. Identified by
 *  its children living under /docs/reference/ rather than by a (translatable) label. */
function groupReference(tree: DocsNavNode[]): DocsNavNode[] {
  return tree.map((node) => {
    const children = node.children;
    if (!children?.some((c) => (c.url ?? "").includes("/reference/")))
      return node;

    const bySlug = new Map(children.map((c) => [slugOf(c.url), c]));
    const used = new Set<string>();
    const groups: DocsNavNode[] = [];
    for (const g of REFERENCE_GROUPS) {
      const kids = g.slugs
        .filter((s) => bySlug.has(s))
        .map((s) => {
          used.add(s);
          return bySlug.get(s) as DocsNavNode;
        });
      if (kids.length) groups.push({ label: g.label, children: kids });
    }
    const leftovers = children.filter((c) => !used.has(slugOf(c.url)));
    return { ...node, children: [...groups, ...leftovers] };
  });
}

export default function ReferenceLayout({ children }: { children: ReactNode }) {
  const tree = groupReference(
    toNav((source.getPageTree().children as TreeNode[]) ?? [])
  );

  // url → plan for plan-gated pages, so the client banner bar can match the active path.
  const planByUrl = Object.fromEntries(
    source
      .getPages()
      .flatMap((p) => (p.data.plan ? [[p.url, p.data.plan as string]] : []))
  );

  return (
    <div className="min-h-screen w-full bg-ed-paper">
      <MainHeader active="reference" mobileNav={<DocsNav tree={tree} />} />

      <div className="mx-auto flex w-full max-w-370 pt-16">
        <aside className="nav-scroll-fade sticky top-16 hidden h-[calc(100dvh-64px)] w-70 shrink-0 overflow-y-auto border-r border-ed-hairline px-5 py-7 scrollbar-hidden-until-scroll lg:block">
          <DocsNav tree={tree} />
          <NavScrollChevron />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <PlanBannerBar plans={planByUrl} />
          <div className="flex min-w-0">
            <main className="min-w-0 flex-1 px-6 pb-35 pt-10 lg:px-14">
              {children}
            </main>
            <aside className="hidden w-58 shrink-0 px-7 pt-10 xl:block">
              <TableOfContents />
            </aside>
          </div>
        </div>
      </div>

      <ScrollHints />
    </div>
  );
}
