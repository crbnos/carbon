/**
 * Authorize that a storage path belongs to at least one of the user's companies.
 * Checks as a full path segment (prefix or slash-bounded), never a loose substring,
 * to ensure `<otherCo>/.../<allowedCompanyId>.pdf` cannot serve another company's file.
 */
export function isPathOwnedByCompanies(
  decodedPath: string,
  companyIds: Iterable<string>
): boolean {
  for (const companyId of companyIds) {
    if (!companyId) continue;
    if (
      decodedPath.startsWith(`${companyId}/`) ||
      decodedPath.includes(`/${companyId}/`)
    ) {
      return true;
    }
  }
  return false;
}
