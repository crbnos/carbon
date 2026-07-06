import type { IssueData } from "./types";

/** Merge-field variable map for an Issue. */
export function buildIssueVars(
  data: Pick<IssueData, "nonConformance" | "company">
): Record<string, string> {
  const nc = data.nonConformance;
  const str = (v: unknown): string => (v == null ? "" : String(v));

  return {
    "issue.number": str(nc?.nonConformanceId),
    "issue.name": str(nc?.name),
    "issue.status": str(nc?.status),
    "issue.openDate": str(nc?.openDate),
    "issue.closeDate": str(nc?.closeDate),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode)
  };
}
