import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb } from "@/components/api/breadcrumb";
import { DocsFooter } from "@/components/api/page-footer";
import { PlanBadge } from "@/components/editorial/reference-components";
import { getMDXComponents } from "@/components/mdx";
import { pageSeo } from "@/lib/seo";
import { source } from "@/lib/source";

type Params = { params: Promise<{ slug?: string[] }> };

type DocTreeNode = {
  type: "page" | "folder" | "separator";
  name?: unknown;
  url?: string;
  index?: { url?: string };
  children?: DocTreeNode[];
};

// Display title of the top-level folder that owns a page, read from the docs
// meta.json via the page tree — so the breadcrumb tracks the real folder titles
// (so a folder can carry a title different from its slug) instead of a hardcoded map.
function groupLabelFor(slug0: string | undefined): string | undefined {
  if (!slug0) return undefined;
  const prefix = `/docs/${slug0}`;
  for (const node of (source.getPageTree().children ?? []) as DocTreeNode[]) {
    if (node.type !== "folder") continue;
    const owns =
      node.index?.url === prefix ||
      (node.children ?? []).some(
        (c) => c.url === prefix || c.url?.startsWith(`${prefix}/`)
      );
    if (owns) return typeof node.name === "string" ? node.name : undefined;
  }
  return undefined;
}

export default async function Page(props: Params) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <article className="max-w-190">
      <Breadcrumb
        items={[
          { label: "Reference", href: page.slugs.length ? "/docs" : undefined },
          ...(page.slugs.length > 1
            ? [{ label: groupLabelFor(page.slugs[0]) ?? page.slugs[0] }]
            : [])
        ]}
      />
      <div className="mt-3.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <h1 className="reference-title m-0">{page.data.title}</h1>
        {page.data.plan && <PlanBadge plan={page.data.plan} />}
      </div>
      {page.data.description && (
        <p className="reference-desc m-0 mt-3">{page.data.description}</p>
      )}
      <div className="prose mt-[30px]">
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page)
          })}
        />
      </div>
      <DocsFooter url={page.url} editPath={`docs/content/docs/${page.path}`} />
    </article>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return pageSeo({
    title: `${page.data.title} — Carbon`,
    ogTitle: page.data.title,
    description: page.data.description,
    path: page.url,
    eyebrow: "Documentation"
  });
}
