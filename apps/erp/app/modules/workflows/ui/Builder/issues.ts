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

/**
 * The same issues, split by which variable inside the field they belong to. A
 * sentence can hold several variables and only one of them be broken, so the field's
 * single message is not enough to colour the right one.
 */
export function partIssuesForField(
  issues: WorkflowIssue[] | undefined,
  ...paths: string[]
): Record<number, string> | undefined {
  let parts: Record<number, string> | undefined;
  for (const issue of issues ?? []) {
    const field = issue.field;
    if (field === undefined) continue;
    for (const path of paths) {
      if (!field.startsWith(`${path}.parts.`)) continue;
      const index = Number(field.slice(`${path}.parts.`.length));
      if (!Number.isInteger(index)) continue;
      parts ??= {};
      parts[index] ??= issue.message;
    }
  }
  return parts;
}
