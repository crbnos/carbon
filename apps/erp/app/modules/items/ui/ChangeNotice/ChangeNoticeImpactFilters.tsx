import { Card, CardContent, HStack } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useMemo } from "react";
import { SearchFilter } from "~/components";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import {
  type ChangeNoticeImpactCoverage,
  type ChangeNoticeImpactWorkspaceCandidate,
  type ChangeNoticeImpactWorkspaceReadModel,
  changeNoticeImpactDecisionStatuses,
  changeNoticeImpactExposureClassifications,
  changeNoticeImpactFreshnessStatuses,
  changeNoticeImpactSourceAvailabilities,
  changeNoticeImpactTargetTypes,
  changeNoticeTaskStatus
} from "~/modules/items";
import { usePeople } from "~/stores";

export const impactFilterOptionValues = {
  targetType: changeNoticeImpactTargetTypes,
  exposureClassification: changeNoticeImpactExposureClassifications,
  decisionStatus: [
    "Unassessed",
    ...changeNoticeImpactDecisionStatuses
  ] as const,
  freshness: changeNoticeImpactFreshnessStatuses,
  sourceAvailability: changeNoticeImpactSourceAvailabilities.filter(
    (value) => value !== "Restricted"
  ),
  taskStatus: changeNoticeTaskStatus
} as const;

export type ChangeNoticeImpactFilterKey = keyof typeof impactFilterOptionValues;
export type ChangeNoticeImpactFilterValues = Partial<
  Record<ChangeNoticeImpactFilterKey | "assignee", string[]>
>;

type Candidate = ChangeNoticeImpactWorkspaceCandidate;
type Coverage = ChangeNoticeImpactWorkspaceReadModel["coverage"];
type TaskCoverageStatus =
  ChangeNoticeImpactWorkspaceReadModel["taskCoverage"]["status"];

type ImpactDecisionFilterValue =
  | "Unassessed"
  | (typeof changeNoticeImpactDecisionStatuses)[number];

export function getImpactFilterValues(
  filterParams: readonly string[]
): ChangeNoticeImpactFilterValues {
  const values: ChangeNoticeImpactFilterValues = {};

  for (const filter of filterParams) {
    const [keyValue, operator, rawValue] = filter.split(":");
    if (!keyValue || !rawValue || !operator) continue;
    if (operator !== "eq" && operator !== "in" && operator !== "contains") {
      continue;
    }

    const key = keyValue as ChangeNoticeImpactFilterKey | "assignee";
    if (
      key !== "assignee" &&
      !Object.prototype.hasOwnProperty.call(impactFilterOptionValues, key)
    ) {
      continue;
    }

    const allowedValues =
      key === "assignee"
        ? null
        : impactFilterOptionValues[key as ChangeNoticeImpactFilterKey];
    const parsedValues = rawValue.split(",").filter((value) => {
      return allowedValues === null || allowedValues.includes(value as never);
    });
    if (parsedValues.length === 0) continue;

    values[key] = [...new Set([...(values[key] ?? []), ...parsedValues])];
  }

  return values;
}

export function getImpactSearchableLabels(candidate: Candidate): string[] {
  // Restricted domains do not contribute ordinary candidate rows. Keep this
  // guard as a second boundary so a malformed DTO can never make a hidden
  // source identity searchable.
  if (candidate.sourceAvailability === "Restricted") return [];

  const labels = [
    candidate.parent?.readableId,
    candidate.parent?.type === "purchaseOrder"
      ? candidate.parent.supplierName
      : null,
    candidate.item?.readableIdWithRevision,
    candidate.item?.readableId
  ];

  return labels.filter((label): label is string => Boolean(label));
}

export function getImpactDecisionFilterValue(
  candidate: Candidate,
  coverageStatus: ChangeNoticeImpactCoverage["status"]
): ImpactDecisionFilterValue | null {
  if (candidate.decision) return candidate.decision.status;

  // This intentionally mirrors the workspace's Unassessed badge semantics.
  // A null decision on a historical, unavailable, or incompletely discovered
  // row is not an Unassessed assessment target.
  if (
    coverageStatus === "complete" &&
    candidate.sourceAvailability === "Present" &&
    candidate.exposureClassification === "Current operational exposure"
  ) {
    return "Unassessed";
  }

  return null;
}

function matchesSelectedValue(
  selectedValues: string[] | undefined,
  value: string | null
) {
  return (
    !selectedValues ||
    selectedValues.length === 0 ||
    (value !== null && selectedValues.includes(value))
  );
}

export function matchesImpactCandidate({
  candidate,
  search,
  filters,
  coverage,
  taskCoverageStatus
}: {
  candidate: Candidate;
  search?: string | null;
  filters: ChangeNoticeImpactFilterValues;
  coverage: Coverage;
  taskCoverageStatus: TaskCoverageStatus;
}): boolean {
  // Restricted source domains must never become visible candidate rows through
  // a display filter, even if a malformed DTO includes one.
  if (candidate.sourceAvailability === "Restricted") return false;

  const query = search?.trim().toLowerCase() ?? "";
  if (
    query &&
    !getImpactSearchableLabels(candidate).some((label) =>
      label.toLowerCase().includes(query)
    )
  ) {
    return false;
  }

  if (!matchesSelectedValue(filters.targetType, candidate.targetType)) {
    return false;
  }
  if (
    !matchesSelectedValue(
      filters.exposureClassification,
      candidate.exposureClassification
    )
  ) {
    return false;
  }
  if (
    !matchesSelectedValue(
      filters.decisionStatus,
      getImpactDecisionFilterValue(
        candidate,
        coverage[candidate.targetType].status
      )
    )
  ) {
    return false;
  }
  if (!matchesSelectedValue(filters.freshness, candidate.freshness)) {
    return false;
  }
  if (
    !matchesSelectedValue(
      filters.sourceAvailability,
      candidate.sourceAvailability
    )
  ) {
    return false;
  }

  // A partial/failed task projection cannot distinguish "no matching task"
  // from "task metadata was not readable". Keep candidates visible rather
  // than treating missing task data as a negative match; the filter bar shows
  // the corresponding bounded-coverage warning.
  if (taskCoverageStatus === "complete") {
    const taskStatuses = filters.taskStatus;
    if (
      taskStatuses &&
      taskStatuses.length > 0 &&
      !candidate.taskLinks.some((task) => taskStatuses.includes(task.status))
    ) {
      return false;
    }

    const assignees = filters.assignee;
    if (
      assignees &&
      assignees.length > 0 &&
      !candidate.taskLinks.some(
        (task) => task.assignee !== null && assignees.includes(task.assignee)
      )
    ) {
      return false;
    }
  }

  return true;
}

export function filterChangeNoticeImpactCandidates({
  candidates,
  search,
  filters,
  coverage,
  taskCoverageStatus
}: {
  candidates: Candidate[];
  search?: string | null;
  filters: ChangeNoticeImpactFilterValues;
  coverage: Coverage;
  taskCoverageStatus: TaskCoverageStatus;
}): Candidate[] {
  return candidates.filter((candidate) =>
    matchesImpactCandidate({
      candidate,
      search,
      filters,
      coverage,
      taskCoverageStatus
    })
  );
}

export function hasImpactDisplayFilters(
  search: string | null | undefined,
  filters: ChangeNoticeImpactFilterValues
) {
  return Boolean(
    search?.trim() ||
      Object.values(filters).some((values) => (values?.length ?? 0) > 0)
  );
}

export type ImpactFilteredEmptyState = "complete" | "incomplete" | null;

export function getImpactFilteredEmptyState({
  candidateCount,
  hasDisplayFilters,
  coverageHasWarning
}: {
  candidateCount: number;
  hasDisplayFilters: boolean;
  coverageHasWarning: boolean;
}): ImpactFilteredEmptyState {
  if (candidateCount > 0 || !hasDisplayFilters) return null;
  return coverageHasWarning ? "incomplete" : "complete";
}

export function hasIncompleteImpactTaskFilter(
  filters: ChangeNoticeImpactFilterValues,
  taskCoverageStatus: TaskCoverageStatus
) {
  return (
    taskCoverageStatus !== "complete" &&
    ((filters.taskStatus?.length ?? 0) > 0 ||
      (filters.assignee?.length ?? 0) > 0)
  );
}

export function ChangeNoticeImpactFilterBar({
  taskCoverageStatus,
  selectionContent,
  selectionNotices
}: {
  taskCoverageStatus: TaskCoverageStatus;
  selectionContent?: ReactNode;
  selectionNotices?: ReactNode;
}) {
  const { t } = useLingui();
  const [people] = usePeople();
  const { hasFilters, urlFiltersParams } = useFilters();
  const filters = useMemo<ColumnFilter[]>(
    () => [
      {
        accessorKey: "targetType",
        header: t`Domain`,
        pluralHeader: t`Domains`,
        filter: {
          type: "static",
          options: [
            {
              value: "purchaseOrderLine",
              label: t`Purchase Order line`
            },
            { value: "job", label: t`Producing Job` },
            { value: "jobMaterial", label: t`Job Material` }
          ]
        }
      },
      {
        accessorKey: "exposureClassification",
        header: t`Exposure`,
        pluralHeader: t`Exposure states`,
        filter: {
          type: "static",
          options: [
            {
              value: "Current operational exposure",
              label: t`Current operational exposure`
            },
            {
              value: "Historical reference",
              label: t`Historical reference`
            },
            {
              value: "No longer in current scope",
              label: t`No longer in current scope`
            }
          ]
        }
      },
      {
        accessorKey: "decisionStatus",
        header: t`Decision`,
        pluralHeader: t`Decisions`,
        filter: {
          type: "static",
          options: [
            { value: "Unassessed", label: t`Unassessed` },
            {
              value: "No action required",
              label: t`No action required`
            },
            { value: "Action required", label: t`Action required` },
            { value: "Resolved", label: t`Resolved` }
          ]
        }
      },
      {
        accessorKey: "freshness",
        header: t`Freshness`,
        pluralHeader: t`Freshness states`,
        filter: {
          type: "static",
          options: [
            { value: "Current", label: t`Current` },
            {
              value: "Changed since assessment",
              label: t`Changed since assessment`
            },
            { value: "Unknown", label: t`Freshness unavailable` }
          ]
        }
      },
      {
        accessorKey: "sourceAvailability",
        header: t`Availability`,
        pluralHeader: t`Availability states`,
        filter: {
          type: "static",
          options: [
            { value: "Present", label: t`Present` },
            { value: "Source deleted", label: t`Source deleted` },
            { value: "Unavailable", label: t`Unavailable` }
          ]
        }
      },
      {
        accessorKey: "taskStatus",
        header: t`Task status`,
        pluralHeader: t`Task statuses`,
        filter: {
          type: "static",
          options: [
            { value: "Pending", label: t`Pending` },
            { value: "In Progress", label: t`In Progress` },
            { value: "Completed", label: t`Completed` },
            { value: "Skipped", label: t`Skipped` }
          ]
        }
      },
      {
        accessorKey: "assignee",
        header: t`Assignee`,
        pluralHeader: t`Assignees`,
        filter: {
          type: "static",
          options: people.map((person) => ({
            value: person.id,
            label: person.name
          }))
        }
      }
    ],
    [people, t]
  );

  const parsedFilters = getImpactFilterValues(urlFiltersParams);
  const hasTaskCoverageWarning = hasIncompleteImpactTaskFilter(
    parsedFilters,
    taskCoverageStatus
  );

  return (
    <Card className="w-full">
      <CardContent className="gap-2 px-4 py-4">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <HStack className="shrink-0">
            <SearchFilter param="search" size="sm" placeholder={t`Search`} />
            <Filter filters={filters} />
          </HStack>
          {selectionContent}
        </div>
        {hasFilters && (
          <div className="mt-2 min-w-0 max-w-full [&>div]:flex-wrap [&>div]:gap-2 [&>div]:space-x-0">
            <ActiveFilters filters={filters} />
          </div>
        )}
        {hasTaskCoverageWarning && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
            <Trans>
              Task filters use incomplete linked-task metadata. Missing tasks or
              assignees are not treated as absent.
            </Trans>
          </div>
        )}
        {selectionNotices}
      </CardContent>
    </Card>
  );
}
