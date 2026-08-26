export const POSTGREST_REPORT_ROW_CAP = 1000;

export function isReportSourceComplete(
  ...sources: (ReadonlyArray<unknown> | null | undefined)[]
): boolean {
  return sources.every(
    (source) => source != null && source.length < POSTGREST_REPORT_ROW_CAP
  );
}
