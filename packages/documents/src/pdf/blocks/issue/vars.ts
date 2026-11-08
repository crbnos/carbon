// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { formatDate } from "@carbon/utils";
import type { MergeToken, RowVars } from "../../../template";
import { str } from "../textVars";
import type {
  ActionTask,
  Associations,
  IssueData,
  JobOperationStepWithRecords
} from "./types";

/** Merge-field variable map for an Issue. */
export function buildIssueVars(
  data: Pick<
    IssueData,
    | "nonConformance"
    | "nonConformanceTypes"
    | "assignees"
    | "company"
    | "locale"
  >
): Record<MergeToken<"issue">, string> {
  const nc = data.nonConformance;

  return {
    "issue.number": str(nc?.nonConformanceId),
    "issue.name": str(nc?.name),
    "issue.status": str(nc?.status),
    "issue.openDate": formatDate(nc?.openDate, undefined, data.locale),
    "issue.closeDate": formatDate(nc?.closeDate, undefined, data.locale),
    "issue.type": str(
      data.nonConformanceTypes.find(
        (type) => type.id === nc?.nonConformanceTypeId
      )?.name
    ),
    "issue.initiatedBy": str(data.assignees[nc?.createdBy]),
    "company.name": str(data.company?.name),
    "company.city": str(data.company?.city),
    "company.country": str(data.company?.countryCode)
  };
}

export function buildIssueTaskVars(
  task: ActionTask,
  data: Pick<IssueData, "requiredActions" | "assignees">
): RowVars<"issue", "task"> {
  return {
    "task.action": str(
      data.requiredActions.find((action) => action.id === task.actionTypeId)
        ?.name
    ),
    "task.supplier": str(task.supplier?.name),
    "task.assignee": task.assignee ? str(data.assignees[task.assignee]) : "",
    "task.completedDate": str(task.completedDate)
  };
}

/**
 * `unknownLabel` is the block's text
 * for a record whose author is not known.
 */
export function buildIssueInspectionVars(
  step: JobOperationStepWithRecords,
  record: JobOperationStepWithRecords["jobOperationStepRecord"][number],
  data: Pick<IssueData, "assignees" | "operationToJobId">,
  unknownLabel: string
): RowVars<"issue", "inspection"> {
  return {
    "inspection.step": str(step.name),
    "inspection.job": str(data.operationToJobId[step.operationId]),
    "inspection.recordedBy": data.assignees[record.createdBy] || unknownLabel,
    "inspection.date": str(record.createdAt).slice(0, 10)
  };
}

/** A zero quantity prints nothing. */
export function buildIssueAssociationVars(
  row: Associations["items"][number]
): RowVars<"issue", "association"> {
  return {
    "association.id": str(row.documentReadableId),
    "association.disposition": str(row.disposition),
    "association.quantity": row.quantity ? str(row.quantity) : ""
  };
}

export function buildIssueReviewerVars(
  reviewer: IssueData["reviewers"][number]
): RowVars<"issue", "reviewer"> {
  return {
    "reviewer.title": str(reviewer.title),
    "reviewer.status": str(reviewer.status)
  };
}
