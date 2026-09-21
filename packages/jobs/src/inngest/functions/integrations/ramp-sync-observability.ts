export type RampFailureResult = {
  failed: number;
  error?: string;
  confirmError?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Keep a family-level drain failure visible in both counts and step output. */
export function recordRampFamilyError(
  result: RampFailureResult,
  error: unknown
): void {
  result.failed += 1;
  result.error = errorMessage(error);
}

/** Count item/drain failures plus confirmation failures that need attention. */
export function countRampSyncFailures(
  results: ReadonlyArray<RampFailureResult>
): number {
  return results.reduce(
    (total, result) => total + result.failed + (result.confirmError ? 1 : 0),
    0
  );
}
