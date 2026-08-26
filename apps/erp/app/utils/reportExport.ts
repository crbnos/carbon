export const POSTGREST_REPORT_ROW_CAP = 1000;

export function isReportSourceComplete(
  ...sources: (ReadonlyArray<unknown> | null | undefined)[]
): boolean {
  return sources.every(
    (source) => source != null && source.length < POSTGREST_REPORT_ROW_CAP
  );
}

type ReportCompanySource<T> = {
  data: T[] | null;
  count: number | null;
  error: unknown;
};

export function resolveReportCompanies<T extends { id: string }>(
  source: ReportCompanySource<T>,
  companiesParam: string | null,
  currentCompanyId: string
): {
  companies: T[];
  selectedCompanyIds: string[] | null;
  isComplete: boolean;
} {
  const companies = source.data ?? [];
  const isComplete =
    source.error == null &&
    source.count != null &&
    source.count === companies.length &&
    companies.some((company) => company.id === currentCompanyId) &&
    isReportSourceComplete(source.data);
  const explicitCompanyIsAvailable =
    companiesParam != null &&
    companiesParam !== "all" &&
    isComplete &&
    companies.some((company) => company.id === companiesParam);

  return {
    companies,
    selectedCompanyIds:
      companiesParam === "all"
        ? isComplete
          ? companies.map((company) => company.id)
          : null
        : companiesParam
          ? explicitCompanyIsAvailable
            ? [companiesParam]
            : null
          : [currentCompanyId],
    isComplete
  };
}
