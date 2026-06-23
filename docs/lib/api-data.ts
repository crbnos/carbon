import raw from "./api-data.generated";
import type { ApiData, ApiModule, ApiResource } from "./api-types";

export const apiData = raw as ApiData;
export const apiModules: ApiModule[] = apiData.modules;
export const apiBase: string = apiData.base;

export function getResource(
  moduleSlug: string,
  resourceSlug: string,
): { module: ApiModule; resource: ApiResource } | null {
  const module = apiModules.find((m) => m.slug === moduleSlug);
  const resource = module?.resources.find((r) => r.slug === resourceSlug);
  if (!module || !resource) return null;
  return { module, resource };
}

export function allResourceParams(): { module: string; resource: string }[] {
  return apiModules.flatMap((m) => m.resources.map((r) => ({ module: m.slug, resource: r.slug })));
}

export const firstResourcePath: string = (() => {
  const m = apiModules[0];
  const r = m?.resources[0];
  return m && r ? `/api-reference/${m.slug}/${r.slug}` : "/api-reference";
})();

// Slim nav tree (no code samples) for the sidebar.
export interface NavEndpoint {
  id: string;
  method: string;
  title: string;
}
export interface NavResource {
  name: string;
  slug: string;
  module: string;
  kind: "table" | "view";
  endpoints: NavEndpoint[];
}
export interface NavModule {
  name: string;
  slug: string;
  resources: NavResource[];
}

// Modules and their resources are listed alphabetically in the nav.
export const navTree: NavModule[] = apiModules
  .map((m) => ({
    name: m.name,
    slug: m.slug,
    resources: m.resources
      .map((r) => ({
        name: r.name,
        slug: r.slug,
        module: m.slug,
        kind: r.kind,
        endpoints: r.endpoints.map((e) => ({ id: e.id, method: e.method, title: e.title })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
