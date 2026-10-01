// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// oRPC's input-validation failure says only "Input validation failed" — useless
// to an agent (or any API caller) that has to fix its own call. The issues ride
// along on the ORPCError's `data`, in standard-schema form: `path` segments are
// keys or `{ key }` wrappers. Name the fields and what's wrong with each.

export type StandardIssue = {
  message?: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
};

const MAX_ISSUES_SHOWN = 8;

export function formatValidationIssues(
  issues: readonly StandardIssue[]
): string {
  const shown = issues.slice(0, MAX_ISSUES_SHOWN).map(formatIssue).join("; ");
  const more =
    issues.length > MAX_ISSUES_SHOWN
      ? `; +${issues.length - MAX_ISSUES_SHOWN} more issues`
      : "";
  return `Input validation failed — ${shown}${more}`;
}

function formatIssue(issue: StandardIssue): string {
  const path = (issue.path ?? [])
    .map((segment) =>
      typeof segment === "object" && segment !== null && "key" in segment
        ? String(segment.key)
        : String(segment)
    )
    .join(".");
  const message = issue.message ?? "invalid";
  return path ? `${path}: ${message}` : message;
}
