// Demo-template part artwork, bundled rather than uploaded. See
// .ai/plans/2026-08-14-demo-template-part-images.md.
//
// The cast stands in for `vite/client` types: declaring `ImportMeta.glob` here
// collides with the real vite types in the apps, and a `vite` devDependency
// resolves a second vite tree against this package's older @types/node. The call
// expression stays literal, which is what vite's glob transform matches on.
const assets = (
  import.meta as unknown as {
    glob(
      pattern: string,
      options: { eager: true; query: string; import: string }
    ): Record<string, string>;
  }
).glob("./assets/**/*.svg", {
  eager: true,
  query: "?url",
  import: "default"
});

export const TEMPLATE_ASSET_PREFIX = "_templates/";

/**
 * Resolves `_templates/<industryId>/<readableId>.svg` to the bundled asset URL.
 * Returns null for any other path, and for a template path with no artwork, so the
 * caller can fall back instead of requesting a URL that does not exist.
 */
export function getDatasetAssetUrl(path: string): string | null {
  if (!path.startsWith(TEMPLATE_ASSET_PREFIX)) return null;
  const rest = path.slice(TEMPLATE_ASSET_PREFIX.length);
  if (rest.includes("..")) return null;
  return assets[`./assets/${rest}`] ?? null;
}
