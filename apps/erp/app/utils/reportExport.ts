export const POSTGREST_REPORT_ROW_CAP = 1000;

export function isReportSourceComplete(
  ...sources: ReadonlyArray<unknown>[]
): boolean {
  return sources.every((source) => source.length < POSTGREST_REPORT_ROW_CAP);
}
