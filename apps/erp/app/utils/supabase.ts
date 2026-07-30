export { sanitize } from "@carbon/utils";

/**
 * Parses a private-bucket job file path. Supports both layouts:
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
