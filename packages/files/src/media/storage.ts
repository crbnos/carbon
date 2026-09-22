import { getDatasetAssetUrl } from "@carbon/database/dataset-assets";

/**
 * Preview URL for a stored private-bucket file. Demo-template artwork ships
 * with the app, so it never goes through the storage proxy; anything else is
 * a real tenant file served by the apps' /file/preview route.
 */
// A `#` or `?` in a stored filename would otherwise truncate the request path.
const encodeStoragePath = (path: string) =>
  path.split("/").map(encodeURIComponent).join("/");

export const getPrivateUrl = (path: string) => {
  // Private files live in one bucket PER COMPANY and stored paths keep the
  // `${companyId}/...` first segment, so the bucket is that segment. The
  // preview route also accepts the legacy shared `private` bucket, which is
  // the fallback when a path has no leading segment.
  const bucket = path.split("/")[0] || "private";
  return (
    getDatasetAssetUrl(path) ??
    `/file/preview/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`
  );
};

/**
 * Raw model source for the viewer's WASM fallback tier — the bucket varies by
 * era (current uploads: temp-staging; pre-assembler rows: private).
 */
export const getRawModelUrl = (bucket: string, path: string) => {
  return `/file/preview/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`;
};

/**
 * Parses a private-bucket job file path — the write side of this contract is
 * the MES step-record upload (`{companyId}/job/{operationId}/{stepId}/{nanoid}/{file}`),
 * the read side the ERP customer-portal file route. Supports both layouts:
 * - legacy flat:   {companyId}/job/{operationId}/{file}
 * - step records:  {companyId}/job/{operationId}/{stepId}/{nanoid}/{file}
 */
export function parseJobFilePath(
  path: string | undefined
): { companyId: string; operationId: string } | null {
  if (!path) return null;
  const [companyId, kind, operationId, ...rest] = path.split("/");
  if (kind !== "job" || !companyId || !operationId) return null;
  if (rest.length !== 1 && rest.length !== 3) return null;
  if (rest.some((segment) => !segment || segment === "." || segment === ".."))
    return null;
  return { companyId, operationId };
}
