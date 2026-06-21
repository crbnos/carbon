import type { ReactNode } from "react";
import { DocsNav, type DocsNavNode } from "@/components/api/docs-nav";
import { TableOfContents } from "@/components/api/toc";
import { MainHeader } from "@/components/main-header";
import { NavScrollChevron } from "@/components/nav-scroll-chevron";
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

const byLabel = (a: DocsNavNode, b: DocsNavNode) =>
  a.label.localeCompare(b.label);

/** Convert the Fumadocs page tree into our serializable nav shape, with the pages in
 *  each group sorted alphabetically. */
function toNav(nodes: TreeNode[]): DocsNavNode[] {
  return nodes.flatMap((n) => {
    if (n.type === "separator") return [];
    if (n.type === "folder") {
      return [
        {
          label: label(n.name),
          url: n.index?.url,
          children: toNav(n.children ?? []).sort(byLabel)
        }
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
  { label: "Items & methods", slugs: ["items", "methods", "routings"] },
  { label: "Sales", slugs: ["quotes", "sales-orders"] },
  {
    label: "Purchasing",
    slugs: ["purchase-orders", "suppliers-and-customers"]
  },
  { label: "Production", slugs: ["jobs", "work-centers", "traceability"] },
  {
    label: "Inventory",
    slugs: ["inventory", "receipts", "shipments", "storage-rules", "shelf-life"]
  },
  { label: "Planning", slugs: ["planning", "reordering"] },
  { label: "Accounting", slugs: ["accounting", "invoices", "fixed-assets"] },
  {
    label: "Quality & maintenance",
    slugs: ["quality", "approvals", "maintenance"]
  }
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

  return (
    <div className="min-h-screen w-full bg-ed-paper">
      <MainHeader active="reference" mobileNav={<DocsNav tree={tree} />} />

      <div className="mx-auto flex w-full max-w-370 pt-16">
        <aside className="nav-scroll-fade sticky top-16 hidden h-[calc(100dvh-64px)] w-70 shrink-0 overflow-y-auto border-r border-ed-hairline px-5 py-7 scrollbar-hidden-until-scroll lg:block">
          <DocsNav tree={tree} />
          <NavScrollChevron />
        </aside>
        <main className="min-w-0 flex-1 px-6 pb-35 pt-10 lg:px-14">
          {children}
        </main>
        <aside className="hidden w-58 shrink-0 px-7 pt-10 xl:block">
          <TableOfContents />
        </aside>
      </div>

      <ScrollHints />
    </div>
  );
}
