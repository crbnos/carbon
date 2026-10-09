// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Subheading,
  VStack
} from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { LuArrowLeft, LuArrowRight } from "react-icons/lu";
import { useNavigate } from "react-router";
import { FieldRow, TreeChildren, TreeNode, ValueRow } from "~/components/Diff";
import {
  useCurrencyFormatter,
  useDateFormatter,
  usePercentFormatter,
  useQuantityFormatter,
  useRouteData
} from "~/hooks";
import type { DiffEntry } from "~/modules/shared/diff";
import { useItems } from "~/stores";
import { path } from "~/utils/path";
import type {
  PlanRow,
  ProjectPlanDiff,
  ProjectPlanSnapshotKey,
  ProjectPlanTable
} from "../../projects.models";
import { buildElementTree, CURRENT_PLAN } from "../../projects.models";
import type { ProjectBaselineListItem } from "../../types";

type Entry = DiffEntry<PlanRow>;
type LineKey = Exclude<ProjectPlanSnapshotKey, "elements">;

/** What a caller adds to each element and each changed field (the review page). */
export type PlanDiffExtras = {
  /** Shown first in an element's body. */
  element?: (elementId: string, entry: Entry) => ReactNode;
  /** An action beside a changed field and content below it. */
  field?: (
    target: { table: ProjectPlanTable; id: string },
    field: string,
    label: string
  ) => { action?: ReactNode; below?: ReactNode } | null;
};

type PlanDiffGroupsProps = {
  diff: ProjectPlanDiff;
  laborCategoryNames: Record<string, string>;
  extras?: PlanDiffExtras;
};

type PlanDiffViewerProps = {
  projectId: string;
  fromId: string;
  toId: string;
  diff: ProjectPlanDiff;
  laborCategoryNames: Record<string, string>;
};

// Never shown as a property: identity and position columns. The element's
// readable id and name are its node label; a move shows as a parent change.
const HIDDEN_FIELDS = new Set(["id", "projectId", "readableId", "sortOrder"]);
const ELEMENT_REF_FIELDS = new Set([
  "parentId",
  "actualParameterId",
  "fromElementId",
  "toElementId"
]);
const MONEY_FIELDS = new Set(["budget", "unitCost", "amount"]);
const QUANTITY_FIELDS = new Set([
  "estimatedHours",
  "quantity",
  "hours",
  "targetValue",
  "targetUpperValue",
  "parameterValue"
]);
const PERCENT_FIELDS = new Set([
  "allocationPercent",
  "parameterContingencyPercent"
]);
const DATE_FIELDS = new Set(["requiredDate", "startDate", "endDate"]);
// Linked records shown as "Linked" rather than as a raw id.
const LINKED_FIELDS = new Set(["trackedEntityId", "qualityDocumentId"]);

const LINE_KEYS: LineKey[] = ["materials", "labor", "costs", "links"];

const lineTables: Record<LineKey, ProjectPlanTable> = {
  materials: "projectElementMaterial",
  labor: "projectElementLabor",
  costs: "projectElementCost",
  links: "projectElementLink"
};

function rowOf(entry: Entry): PlanRow {
  return (entry.after ?? entry.before) as PlanRow;
}

/** The element a plan line or a link belongs to. */
function ownerOf(key: LineKey, row: PlanRow): string | null {
  const id = key === "links" ? row.fromElementId : row.projectElementId;
  return typeof id === "string" ? id : null;
}

export type PlanDiffGroup = {
  entry: Entry;
  lines: { key: LineKey; entry: Entry }[];
};

/**
 * Groups a plan diff by element, in the target's tree order, with removed
 * elements last. An element shows when it or one of its lines changed.
 */
export function planDiffGroups(diff: ProjectPlanDiff): PlanDiffGroup[] {
  const linesByElement = new Map<string, { key: LineKey; entry: Entry }[]>();
  for (const key of LINE_KEYS) {
    for (const entry of diff[key]) {
      if (entry.status === "unchanged") continue;
      const owner = ownerOf(key, rowOf(entry));
      if (!owner) continue;
      const lines = linesByElement.get(owner) ?? [];
      lines.push({ key, entry });
      linesByElement.set(owner, lines);
    }
  }

  const targetRows = diff.elements
    .filter((entry) => entry.after)
    .map((entry) => entry.after as PlanRow & { parentId: string | null });
  const order = buildElementTree(
    targetRows.map((row) => ({
      ...row,
      parentId: (row.parentId as string | null) ?? null,
      sortOrder: Number(row.sortOrder ?? 0)
    }))
  ).map((node) => node.id);
  const byId = new Map(diff.elements.map((e) => [rowOf(e).id, e]));
  const removed = diff.elements
    .filter((entry) => entry.status === "removed")
    .map((entry) => rowOf(entry).id);

  return [...order, ...removed]
    .map((id) => ({
      entry: byId.get(id)!,
      lines: linesByElement.get(id) ?? []
    }))
    .filter(({ entry, lines }) => entry.status !== "unchanged" || lines.length);
}

/**
 * The diff of two plan snapshots, grouped by element in the target's tree
 * order. Each changed element shows its changed fields, then its changed plan
 * lines and links. Removed elements come last.
 */
export function PlanDiffGroups({
  diff,
  laborCategoryNames,
  extras
}: PlanDiffGroupsProps) {
  const { t } = useLingui();
  const [items] = useItems();
  const formatMoney = useCurrencyFormatter();
  const formatQuantity = useQuantityFormatter();
  const formatPercent = usePercentFormatter();
  const { formatDate } = useDateFormatter();
  const labels: Record<string, string> = {
    name: t`Name`,
    description: t`Description`,
    type: t`Type`,
    parentId: t`Parent`,
    isChargeable: t`Chargeable`,
    budget: t`Budget`,
    estimatedHours: t`Estimated hours`,
    itemId: t`Part`,
    trackedEntityId: t`Serial`,
    requirementCategory: t`Category`,
    targetOperator: t`Operator`,
    targetValue: t`Target`,
    targetUpperValue: t`Upper target`,
    targetUnit: t`Target unit`,
    verificationMethod: t`Verification`,
    actualParameterId: t`Actual parameter`,
    qualityDocumentId: t`Procedure`,
    parameterValue: t`Value`,
    parameterUnit: t`Unit`,
    parameterSource: t`Source`,
    parameterFormula: t`Formula`,
    parameterItemField: t`Part field`,
    parameterContingencyPercent: t`Contingency`,
    allocationPercent: t`Allocation`,
    methodType: t`Method`,
    quantity: t`Quantity`,
    unitOfMeasureCode: t`Unit`,
    requiredDate: t`Required date`,
    unitCost: t`Unit cost`,
    laborCategoryId: t`Labor category`,
    hours: t`Hours`,
    startDate: t`Start date`,
    endDate: t`End date`,
    amount: t`Amount`,
    linkType: t`Link type`,
    fromElementId: t`From`,
    toElementId: t`To`
  };

  // Readable ids of every element on either side, for parents and links.
  const elementLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of diff.elements) {
      const row = rowOf(entry);
      map.set(row.id, String(row.readableId || row.name || ""));
    }
    return map;
  }, [diff.elements]);

  const groups = useMemo(() => planDiffGroups(diff), [diff]);

  const display = (field: string, value: unknown): unknown => {
    if (value === null || value === undefined || value === "") return null;
    if (ELEMENT_REF_FIELDS.has(field)) {
      return elementLabels.get(String(value)) || t`Unknown element`;
    }
    if (field === "itemId") {
      return getItemReadableId(items, String(value)) ?? t`Unknown part`;
    }
    if (field === "laborCategoryId") {
      return laborCategoryNames[String(value)] ?? t`Unknown labor category`;
    }
    if (LINKED_FIELDS.has(field)) return t`Linked`;
    if (MONEY_FIELDS.has(field)) return formatMoney.format(Number(value));
    if (QUANTITY_FIELDS.has(field)) return formatQuantity(Number(value));
    if (PERCENT_FIELDS.has(field)) return formatPercent.format(Number(value));
    if (DATE_FIELDS.has(field)) return formatDate(String(value));
    return value;
  };

  const visibleFields = (row: PlanRow, skip: Set<string>) =>
    Object.keys(row).filter(
      (field) =>
        !HIDDEN_FIELDS.has(field) &&
        !skip.has(field) &&
        row[field] !== null &&
        row[field] !== undefined &&
        row[field] !== ""
    );

  const entryBody = (
    entry: Entry,
    skip: Set<string>,
    table: ProjectPlanTable
  ): ReactNode[] => {
    if (entry.status === "modified") {
      return Object.entries(entry.changedFields ?? {})
        .filter(([field]) => !HIDDEN_FIELDS.has(field) && !skip.has(field))
        .map(([field, { before, after }]) => {
          const row = (
            <FieldRow
              field={field}
              before={display(field, before)}
              after={display(field, after)}
              labels={labels}
            />
          );
          const extra = extras?.field?.(
            { table, id: rowOf(entry).id },
            field,
            labels[field] ?? field
          );
          if (!extra) return <div key={field}>{row}</div>;
          return (
            <div key={field} className="flex w-full flex-col gap-1">
              <div className="flex w-full min-w-0 items-center gap-1">
                <div className="min-w-0 flex-1">{row}</div>
                {extra.action}
              </div>
              {extra.below}
            </div>
          );
        });
    }
    if (entry.status === "added" || entry.status === "removed") {
      const row = rowOf(entry);
      return visibleFields(row, skip).map((field) => (
        <ValueRow
          key={field}
          field={field}
          value={display(field, row[field])}
          variant={entry.status === "added" ? "new" : "old"}
          labels={labels}
        />
      ));
    }
    return [];
  };

  const lineLabel = (key: LineKey, row: PlanRow): string => {
    switch (key) {
      case "materials":
        return String(display("itemId", row.itemId) ?? t`Material`);
      case "labor":
        return String(
          display("laborCategoryId", row.laborCategoryId) ?? t`Labor`
        );
      case "costs":
        return String(row.description || t`Other cost`);
      case "links":
        return `${String(row.linkType)} ${String(display("toElementId", row.toElementId) ?? "")}`.trim();
    }
  };
  const lineSkip: Record<LineKey, Set<string>> = {
    materials: new Set(["projectElementId", "itemId"]),
    labor: new Set(["projectElementId", "laborCategoryId"]),
    costs: new Set(["projectElementId", "description"]),
    links: new Set(["fromElementId"])
  };
  const lineTitles: Record<LineKey, string> = {
    materials: t`Materials`,
    labor: t`Labor`,
    costs: t`Other costs`,
    links: t`Trace links`
  };

  const elementSkip = new Set(["name"]);

  return (
    <div className="w-full rounded-lg border border-border bg-card p-3">
      {groups.length === 0 ? (
        <span className="text-sm italic text-muted-foreground">
          <Trans>No differences.</Trans>
        </span>
      ) : (
        <VStack spacing={4} className="w-full">
          {groups.map(({ entry, lines }) => {
            const row = rowOf(entry);
            const fields = entryBody(entry, elementSkip, "projectElement");
            // A change of position only (a reorder) has no field to show.
            const body =
              entry.status === "modified" && fields.length === 0
                ? [
                    <span key="moved" className="text-xs text-muted-foreground">
                      <Trans>Position changed</Trans>
                    </span>
                  ]
                : fields;
            const label = `${row.readableId ? `${row.readableId} ` : ""}${String(row.name ?? "")}`;
            return (
              <TreeNode
                key={row.id}
                label={label}
                status={entry.status}
                collapsible={
                  Boolean(extras?.element) ||
                  body.length > 0 ||
                  lines.length > 0
                }
              >
                {extras?.element?.(row.id, entry)}
                {body}
                {LINE_KEYS.map((key) => {
                  const changed = lines.filter((line) => line.key === key);
                  if (changed.length === 0) return null;
                  return (
                    <div key={key} className="w-full">
                      <Subheading variant="heavy" className="block pb-0.5">
                        {lineTitles[key]}
                      </Subheading>
                      <TreeChildren>
                        {changed.map(({ entry: line }) => {
                          const lineBody = entryBody(
                            line,
                            lineSkip[key],
                            lineTables[key]
                          );
                          return (
                            <TreeNode
                              key={rowOf(line).id}
                              label={lineLabel(key, rowOf(line))}
                              status={line.status}
                              collapsible={lineBody.length > 0}
                            >
                              {lineBody}
                            </TreeNode>
                          );
                        })}
                      </TreeChildren>
                    </div>
                  );
                })}
              </TreeNode>
            );
          })}
        </VStack>
      )}
    </div>
  );
}

const PlanDiffViewer = ({
  projectId,
  fromId,
  toId,
  diff,
  laborCategoryNames
}: PlanDiffViewerProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const baselines =
    useRouteData<{ baselines: ProjectBaselineListItem[] }>(
      path.to.projectBaselines(projectId)
    )?.baselines ?? [];
  const groups = useMemo(() => planDiffGroups(diff), [diff]);

  const setCompare = (from: string, to: string) =>
    navigate(path.to.projectBaselineCompare(projectId, from, to), {
      replace: true
    });

  return (
    <div className="mx-auto flex w-full max-w-[80rem] flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <IconButton
          aria-label={t`Back to baselines`}
          icon={<LuArrowLeft />}
          variant="ghost"
          size="sm"
          onClick={() => navigate(path.to.projectBaselines(projectId))}
        />
        <h2 className="mr-2 text-base font-medium">
          <Trans>Compare</Trans>
        </h2>
        <Select
          value={fromId}
          onValueChange={(value) => setCompare(value, toId)}
        >
          <SelectTrigger size="sm" className="w-56" aria-label={t`From`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {baselines.map((baseline) => (
              <SelectItem key={baseline.id} value={baseline.id}>
                #{baseline.sequence} {baseline.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <LuArrowRight className="size-4 shrink-0 text-muted-foreground" />
        <Select
          value={toId}
          onValueChange={(value) => setCompare(fromId, value)}
        >
          <SelectTrigger size="sm" className="w-56" aria-label={t`To`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CURRENT_PLAN}>{t`Current plan`}</SelectItem>
            {baselines
              .filter((baseline) => baseline.id !== fromId)
              .map((baseline) => (
                <SelectItem key={baseline.id} value={baseline.id}>
                  #{baseline.sequence} {baseline.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          <Plural
            value={groups.length}
            one="# element changed"
            other="# elements changed"
          />
        </span>
      </div>

      <PlanDiffGroups diff={diff} laborCategoryNames={laborCategoryNames} />
    </div>
  );
};

export default PlanDiffViewer;
