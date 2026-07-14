import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BaseUrl } from "@/components/api/base-url";
import { Breadcrumb } from "@/components/api/breadcrumb";
import { EndpointSection } from "@/components/api/endpoint-section";
import { ViewCallout, TableCallout } from "@/components/api/view-callout";
import { allResourceParams, apiBase, getResource } from "@/lib/api-data";
import { TABLE_VIEW_COMPANIONS, VIEW_TABLE_COMPANIONS } from "@/lib/api-companion-views";
import { pageSeo } from "@/lib/seo";

type Params = { params: Promise<{ module: string; resource: string }> };

export function generateStaticParams() {
  return allResourceParams();
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { module, resource } = await props.params;
  const found = getResource(module, resource);
  return pageSeo({
    title: found ? `${found.resource.name} — Carbon API` : "Carbon API",
    ogTitle: found?.resource.name ?? "Carbon API",
    description: found?.resource.description,
    path: `/api-reference/${module}/${resource}`,
    eyebrow: found ? found.module.name : "API reference"
  });
}

export default async function ResourcePage(props: Params) {
  const { module, resource } = await props.params;
  const found = getResource(module, resource);
  if (!found) notFound();
  const { module: mod, resource: r } = found;

  return (
    <div className="max-w-295">
      <Breadcrumb
        items={[{ label: "API", href: "/api-reference" }, { label: mod.name }]}
      />
      <h1 className="m-0 mt-2 text-ed-32 font-semi leading-[120%] text-ed-ink">
        {r.name}
      </h1>
      <p className="m-0 mt-3 max-w-160 text-ed-16 leading-[160%] text-ed-ink/80">
        {r.description}
      </p>
      <BaseUrl path={r.endpoints[0]?.path ?? ""} />

      {r.kind === "table" && TABLE_VIEW_COMPANIONS[r.table] && (
        <ViewCallout
          tableName={r.table}
          viewName={TABLE_VIEW_COMPANIONS[r.table].viewTable}
          viewHref={`/api-reference/${TABLE_VIEW_COMPANIONS[r.table].viewModule}/${TABLE_VIEW_COMPANIONS[r.table].viewSlug}`}
        />
      )}
      {r.kind === "view" && VIEW_TABLE_COMPANIONS[r.table] && (
        <TableCallout
          tableName={VIEW_TABLE_COMPANIONS[r.table].tableTable}
          tableHref={`/api-reference/${VIEW_TABLE_COMPANIONS[r.table].tableModule}/${VIEW_TABLE_COMPANIONS[r.table].tableSlug}`}
        />
      )}

      {r.endpoints.map((e) => (
        <EndpointSection key={e.id} endpoint={e} base={apiBase} />
      ))}
    </div>
  );
}
