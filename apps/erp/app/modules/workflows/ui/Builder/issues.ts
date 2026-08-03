import type { WorkflowIssue } from "@carbon/workflows";

/**
 * The message for the first issue that names one of these field paths. A bad
 * variable inside a template reports as `<field>.parts.<n>`, so those match too —
 * otherwise the error would have nowhere to show.
 */
export function issueForField(
  issues: WorkflowIssue[] | undefined,
  ...paths: string[]
): string | undefined {
  return issues?.find((issue) => {
    const field = issue.field;
    if (field === undefined) return false;
    return paths.some(
      (path) => field === path || field.startsWith(`${path}.parts.`)
    );
  })?.message;
}
