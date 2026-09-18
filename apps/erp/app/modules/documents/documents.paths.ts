import { stripSpecialCharacters } from "@carbon/utils";

/**
 * Build the canonical storage path for an uploaded document:
 * `${companyId}/${folder}/${entityId}/${sanitizedName}` in the `"private"` bucket.
 * Single source of truth for the path convention every `use*Documents` hook
 * inlines client-side; shared so the server-side (MCP) upload methods produce
 * paths the entity document panels list from.
 */
export function buildDocumentUploadPath({
  companyId,
  folder,
  entityId,
  name
}: {
  companyId: string;
  folder: string;
  entityId: string;
  name: string;
}): string {
  return `${companyId}/${folder}/${entityId}/${stripSpecialCharacters(name)}`;
}

/**
 * Staging path for a signed-URL upload that needs server-side processing
 * before it becomes a document (today: HEIC → JPEG at registration). The
 * final destination is encoded in the path so `insertUploadedDocument` can
 * derive it from the path alone — the caller only ever round-trips the path
 * the mint returned. Everything under `{companyId}/tmp/` is transient by
 * contract and swept nightly by the cleanup job.
 */
export function buildStagedUploadPath({
  companyId,
  folder,
  entityId,
  name
}: {
  companyId: string;
  folder: string;
  entityId: string;
  name: string;
}): string {
  return `${companyId}/tmp/uploads/${folder}/${entityId}/${stripSpecialCharacters(
    name
  )}`;
}

/** Inverse of `buildStagedUploadPath`; null for any non-staging path. */
export function parseStagedUploadPath(path: string): {
  companyId: string;
  folder: string;
  entityId: string;
  name: string;
} | null {
  const segments = path.split("/");
  if (
    segments.length !== 6 ||
    segments[1] !== "tmp" ||
    segments[2] !== "uploads" ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  const [companyId, , , folder, entityId, name] = segments;
  return { companyId, folder, entityId, name };
}
