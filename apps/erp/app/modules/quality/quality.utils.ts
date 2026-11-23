// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

/**
 * The issue type a receipt inspection lot's NCR opens with: one for supplier or
 * receiving problems, else the first.
 */
export function receiptLotIssueType<Type extends { id: string; name: string }>(
  types: readonly Type[] | null | undefined
): Type | undefined {
  const list = types ?? [];
  return (
    list.find((type) =>
      /supplier|vendor|receiv|incoming|goods.in/i.test(type.name)
    ) ?? list[0]
  );
}

type Tables = Database["public"]["Tables"];

export type ScarIssue = Pick<
  Tables["nonConformance"]["Row"],
  "nonConformanceId" | "name" | "status"
>;

export type ScarActionTask = Pick<
  Tables["nonConformanceActionTask"]["Row"],
  "id" | "status" | "supplierId" | "notes"
> & { name?: string | null };

export type ScarCompany = Pick<
  Tables["company"]["Row"],
  "name" | "logoLight" | "logoDark"
>;

/**
 * What a SCAR link sends the logged-out supplier: the issue's number, name and
 * status, and the supplier's own action tasks. The issue's description,
 * dispositions, assignees and integration links stay internal.
 */
export function scarForSupplier({
  issue,
  company,
  supplier,
  actionTasks
}: {
  issue: ScarIssue;
  company: ScarCompany | null;
  supplier: { name: string | null } | null;
  actionTasks: ScarActionTask[];
}): {
  issue: ScarIssue;
  company: ScarCompany | null;
  supplier: { name: string | null } | null;
  actionTasks: ScarActionTask[];
} {
  return {
    issue: {
      nonConformanceId: issue.nonConformanceId,
      name: issue.name,
      status: issue.status
    },
    company: company
      ? {
          name: company.name,
          logoLight: company.logoLight,
          logoDark: company.logoDark
        }
      : null,
    supplier: supplier ? { name: supplier.name } : null,
    actionTasks: actionTasks.map((task) => ({
      id: task.id,
      name: task.name ?? null,
      status: task.status,
      supplierId: task.supplierId,
      notes: task.notes
    }))
  };
}
