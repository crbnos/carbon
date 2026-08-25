// Demo-template part artwork and CAD assemblies, bundled rather than uploaded.
// See .ai/plans/2026-08-14-demo-template-part-images.md and assets/ATTRIBUTION.md.
//
// The cast stands in for `vite/client` types: declaring `ImportMeta.glob` here
// collides with the real vite types in the apps, and a `vite` devDependency
// resolves a second vite tree against this package's older @types/node. Both the
// pattern and the options must stay inline literals — vite's glob transform reads
// them statically, and hoisting either into a const fails the build.
const assets = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { eager: true; query: string; import: string }
    ): Record<string, string>;
  }
).glob("./assets/**/*.{svg,glb,json}", {
  eager: true,
  query: "?url",
  import: "default"
});

export const TEMPLATE_ASSET_PREFIX = "_templates/";

/**
 * Resolves a bundled demo-template asset to its URL — `<industryId>/<readableId>.svg`
 * part artwork, or `<industryId>/models/<name>.{glb,graph.json}` CAD assemblies.
 * Returns null for any other path, and for a template path with no asset, so the
 * caller can fall back instead of requesting a URL that does not exist.
 */
export function getDatasetAssetUrl(path: string): string | null {
  if (!path.startsWith(TEMPLATE_ASSET_PREFIX)) return null;
  const rest = path.slice(TEMPLATE_ASSET_PREFIX.length);
  if (rest.includes("..")) return null;
  return assets[`./assets/${rest}`] ?? null;
}
