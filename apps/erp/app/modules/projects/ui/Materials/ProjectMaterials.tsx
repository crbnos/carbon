// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Status,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { PROJECT_MATERIAL_ISSUE_STATUS_COLOR_MAP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { Fragment } from "react";
import { useParams } from "react-router";
import { DateTime, Hyperlink, MethodIcon, SearchFilter } from "~/components";
import Empty from "~/components/Empty";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { RowLimitNote } from "~/components/Table/components/RowLimitNote";
import { useQuantityFormatter, useUrlParams } from "~/hooks";
import { jobStatus } from "~/modules/production/production.models";
import JobStatus from "~/modules/production/ui/Jobs/JobStatus";
import { purchaseOrderStatusType } from "~/modules/purchasing/purchasing.models";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { path } from "~/utils/path";
import type {
  ProjectMaterialIssueStatus,
  ProjectMaterialRow
} from "../../projects.service";
import { useMethodTypeLabels } from "../Element/ElementPlanLines";
import { StateIcon } from "../Project/StateIcon";
import type { MaterialGroup, MaterialGroupBy } from "./project-materials";
import {
  filterMaterialRows,
  groupMaterialRows,
  NO_ELEMENT_GROUP,
  NO_SUPPLY,
  supplyStatuses
} from "./project-materials";

type ProjectMaterialsProps = {
  rows: ProjectMaterialRow[];
  /** The RPC had more rows than the page shows. */
  isTruncated: boolean;
};

const issueStatuses: ProjectMaterialIssueStatus[] = [
  "Not issued",
  "Partly issued",
  "Issued",
  "Unplanned"
];

/**
 * The project Materials page: every plan line of the project and the issues,
 * PO lines and jobs of the project that no plan line links, grouped by element
 * or by item. Search, the status filters and the grouping live in the URL.
 */
export default function ProjectMaterials({
  rows,
  isTruncated
}: ProjectMaterialsProps) {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const formatQuantity = useQuantityFormatter();
  const [params, setParams] = useUrlParams();
  const { getFilter, hasFilters } = useFilters();

  const search = params.get("search");
  const supplyStatus = getFilter("supplyStatus");
  const issueStatus = getFilter("issueStatus");
  const groupBy: MaterialGroupBy =
    params.get("groupBy") === "item" ? "item" : "element";

  const methodLabels = useMethodTypeLabels();
  const issueStatusLabels: Record<ProjectMaterialIssueStatus, string> = {
    "Not issued": t`Not issued`,
    "Partly issued": t`Partly issued`,
    Issued: t`Issued`,
    Unplanned: t`Unplanned`
  };

  // A job status that is also a PO status (Draft, Completed…) is one option:
  // the filter matches the stored status of either.
  const jobOnlyStatuses = jobStatus.filter(
    (status) => !(purchaseOrderStatusType as readonly string[]).includes(status)
  );
  const filters: ColumnFilter[] = [
    {
      accessorKey: "supplyStatus",
      header: t`Supply status`,
      pluralHeader: t`Supply statuses`,
      filter: {
        type: "static",
        options: [
          { value: NO_SUPPLY, label: t`No supply` },
          ...purchaseOrderStatusType.map((status) => ({
            value: status,
            label: <PurchasingStatus status={status} />
          })),
          ...jobOnlyStatuses.map((status) => ({
            value: status,
            label: <JobStatus status={status} />
          }))
        ]
      }
    },
    {
      accessorKey: "issueStatus",
      header: t`Issue status`,
      pluralHeader: t`Issue statuses`,
      filter: {
        type: "static",
        options: issueStatuses.map((status) => ({
          value: status,
          label: (
            <Status color={PROJECT_MATERIAL_ISSUE_STATUS_COLOR_MAP[status]}>
              {issueStatusLabels[status]}
            </Status>
          )
        }))
      }
    }
  ];

  const filtered = filterMaterialRows(rows, {
    search,
    supplyStatus,
    issueStatus
  });
  const groups = groupMaterialRows(filtered, groupBy);
  const showOnHand = filtered.some((row) => row.projectOnHand !== null);
  const columnCount = showOnHand ? 13 : 11;

  const quantity = (value: number | null, unit: string | null) =>
    value === null ? null : (
      <span className="whitespace-nowrap tabular-nums">
        {formatQuantity(value)}
        {unit && <span className="ml-1 text-muted-foreground">{unit}</span>}
      </span>
    );

  const supplyCell = (row: ProjectMaterialRow) => {
    if (row.supplies.length === 0) {
      return supplyStatuses(row).includes(NO_SUPPLY) ? (
        <span className="whitespace-nowrap text-muted-foreground">
          <Trans>No supply</Trans>
        </span>
      ) : null;
    }
    return (
      <div className="flex min-w-0 flex-col gap-1">
        {row.supplies.map((supply) => (
          <div
            key={`${supply.type}:${supply.documentId}:${supply.lineId ?? ""}`}
            className="flex items-center gap-2"
          >
            <Hyperlink
              to={
                supply.type === "Job"
                  ? path.to.job(supply.documentId)
                  : path.to.purchaseOrder(supply.documentId)
              }
            >
              <span className="whitespace-nowrap">{supply.readableId}</span>
            </Hyperlink>
            {supply.type === "Job" ? (
              <JobStatus
                status={
                  supply.status as Database["public"]["Enums"]["jobStatus"]
                }
              />
            ) : (
              <PurchasingStatus
                status={
                  supply.status as Database["public"]["Enums"]["purchaseOrderStatus"]
                }
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  const groupHeader = (group: MaterialGroup) => {
    const first = group.rows[0];
    if (groupBy === "element") {
      if (group.key === NO_ELEMENT_GROUP || !first?.projectElementId) {
        return (
          <span className="font-medium text-muted-foreground">
            <Trans>Project (no element)</Trans>
          </span>
        );
      }
      return (
        <div className="flex min-w-0 items-center gap-2">
          {first.elementStateGroup && (
            <StateIcon
              group={first.elementStateGroup}
              color={first.elementStateColor ?? "currentColor"}
              className="shrink-0"
            />
          )}
          <Hyperlink
            to={path.to.projectElement(projectId, first.projectElementId)}
          >
            <span className="whitespace-nowrap font-medium">
              {first.elementReadableId ?? first.elementName}
            </span>
          </Hyperlink>
          {first.elementReadableId && first.elementName && (
            <span className="truncate text-xs text-muted-foreground">
              {first.elementName}
            </span>
          )}
        </div>
      );
    }
    const unit = first?.unitOfMeasureCode ?? null;
    const totals = group.totals;
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <Hyperlink to={path.to.inventoryItem(group.key)}>
            <span className="whitespace-nowrap font-medium">
              {first?.itemReadableId ?? group.key}
            </span>
          </Hyperlink>
          <span className="truncate text-xs text-muted-foreground">
            {first?.itemName ?? ""}
          </span>
        </div>
        {totals && (
          <div className="flex shrink-0 items-center gap-3 whitespace-nowrap text-xs text-muted-foreground">
            <span>
              <Trans>Required {quantity(totals.quantityRequired, unit)}</Trans>
            </span>
            <span>
              <Trans>Ordered {quantity(totals.quantityOrdered, unit)}</Trans>
            </span>
            <span>
              <Trans>Received {quantity(totals.quantityReceived, unit)}</Trans>
            </span>
            <span>
              <Trans>Issued {quantity(totals.quantityIssued, unit)}</Trans>
            </span>
            <span>
              <Trans>
                Remaining {quantity(totals.quantityRemaining, unit)}
              </Trans>
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex w-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <SearchFilter param="search" size="sm" placeholder={t`Search`} />
        {hasFilters ? (
          <ActiveFilters filters={filters} />
        ) : (
          <Filter filters={filters} />
        )}
        <div className="flex-1" />
        <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
          <Trans>Group by</Trans>
        </span>
        <div className="w-36 shrink-0">
          <Select
            value={groupBy}
            onValueChange={(value) =>
              setParams({ groupBy: value === "item" ? "item" : null })
            }
          >
            <SelectTrigger size="sm" aria-label={t`Group by`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="element">
                <Trans>Element</Trans>
              </SelectItem>
              <SelectItem value="item">
                <Trans>Item</Trans>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="@container">
        {rows.length === 0 ? (
          <Empty
            title={<Trans>No materials</Trans>}
            description={
              <Trans>
                The plan lines of the project's elements appear here, with the
                issues, PO lines and jobs of the project.
              </Trans>
            }
          />
        ) : filtered.length === 0 ? (
          <Empty
            title={<Trans>No materials match the filters</Trans>}
            description={null}
          />
        ) : (
          <TableBase full>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Item</Trans>
                </Th>
                <Th>
                  <Trans>Element</Trans>
                </Th>
                <Th>
                  <Trans>Method</Trans>
                </Th>
                <Th>
                  <Trans>Required</Trans>
                </Th>
                <Th>
                  <Trans>Ordered</Trans>
                </Th>
                <Th>
                  <Trans>Received</Trans>
                </Th>
                <Th>
                  <Trans>Issued</Trans>
                </Th>
                <Th>
                  <Trans>Remaining</Trans>
                </Th>
                <Th>
                  <Trans>Required date</Trans>
                </Th>
                <Th>
                  <Trans>Supply</Trans>
                </Th>
                <Th>
                  <Trans>Issue status</Trans>
                </Th>
                {showOnHand && (
                  <>
                    <Th>
                      <Trans>Project on hand</Trans>
                    </Th>
                    <Th>
                      <Trans>Unassigned on hand</Trans>
                    </Th>
                  </>
                )}
              </Tr>
            </Thead>
            <Tbody>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <Tr className="bg-muted/40">
                    <Td colSpan={columnCount}>{groupHeader(group)}</Td>
                  </Tr>
                  {group.rows.map((row) => {
                    const unit = row.unitOfMeasureCode;
                    return (
                      <Tr
                        key={
                          row.projectElementMaterialId ??
                          `unplanned:${row.projectElementId ?? ""}:${row.itemId}`
                        }
                      >
                        <Td>
                          <div className="flex min-w-0 flex-col">
                            <Hyperlink to={path.to.inventoryItem(row.itemId)}>
                              <span className="whitespace-nowrap">
                                {row.itemReadableId}
                              </span>
                            </Hyperlink>
                            <span className="truncate text-xs text-muted-foreground">
                              {row.itemName}
                            </span>
                          </div>
                        </Td>
                        <Td>
                          {row.projectElementId ? (
                            <div className="flex items-center gap-2">
                              {row.elementStateGroup && (
                                <StateIcon
                                  group={row.elementStateGroup}
                                  color={
                                    row.elementStateColor ?? "currentColor"
                                  }
                                  className="shrink-0"
                                />
                              )}
                              <Hyperlink
                                to={path.to.projectElement(
                                  projectId,
                                  row.projectElementId
                                )}
                              >
                                <span className="whitespace-nowrap">
                                  {row.elementReadableId ?? row.elementName}
                                </span>
                              </Hyperlink>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                              <Trans>Project</Trans>
                            </span>
                          )}
                        </Td>
                        <Td>
                          {row.methodType && (
                            <span className="flex items-center gap-1 whitespace-nowrap">
                              <MethodIcon
                                type={row.methodType}
                                className="size-3 shrink-0"
                              />
                              {methodLabels[row.methodType]}
                            </span>
                          )}
                        </Td>
                        <Td>{quantity(row.quantityRequired, unit)}</Td>
                        <Td>{quantity(row.quantityOrdered, unit)}</Td>
                        <Td>{quantity(row.quantityReceived, unit)}</Td>
                        <Td>{quantity(row.quantityIssued, unit)}</Td>
                        <Td>{quantity(row.quantityRemaining, unit)}</Td>
                        <Td className="whitespace-nowrap">
                          {row.requiredDate ? (
                            <DateTime value={row.requiredDate} variant="date" />
                          ) : null}
                        </Td>
                        <Td>{supplyCell(row)}</Td>
                        <Td>
                          <Status
                            color={
                              PROJECT_MATERIAL_ISSUE_STATUS_COLOR_MAP[
                                row.issueStatus
                              ]
                            }
                          >
                            {issueStatusLabels[row.issueStatus]}
                          </Status>
                        </Td>
                        {showOnHand && (
                          <>
                            <Td>{quantity(row.projectOnHand, unit)}</Td>
                            <Td>{quantity(row.unassignedOnHand, unit)}</Td>
                          </>
                        )}
                      </Tr>
                    );
                  })}
                </Fragment>
              ))}
            </Tbody>
          </TableBase>
        )}
        {isTruncated && <RowLimitNote className="px-4 py-3" />}
      </div>
    </div>
  );
}
