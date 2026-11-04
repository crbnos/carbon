// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, HStack } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuBox,
  LuCalendar,
  LuFileText,
  LuGroup,
  LuTag,
  LuTarget
} from "react-icons/lu";
import {
  DateTime,
  EmployeeAvatar,
  exportOnlyColumn,
  Highlight,
  Hyperlink,
  New,
  searchMatches,
  Table
} from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import type { InspectionPlanPart } from "../../types";

type InspectionDocumentTableProps = {
  data: InspectionPlanPart[];
  count: number;
  infinite: InfiniteOptions;
  tags: { name: string }[];
};

const defaultColumnVisibility = {
  createdAt: false,
  itemPostingGroupId: false,
  tags: false
};

/** One row per part; its inspection plans are the expanded row, open while a
 *  search is, with the matches marked. */
const InspectionDocumentTable = memo(
  ({ data, count, infinite, tags }: InspectionDocumentTableProps) => {
    const [params] = useUrlParams();
    const { t } = useLingui();
    const permissions = usePermissions();
    const [items] = useItems();
    const itemPostingGroups = useItemPostingGroups();
    const search = params.get("search");

    const columns = useMemo<ColumnDef<InspectionPlanPart>[]>(
      () => [
        {
          accessorKey: "partReadableId",
          header: t`Part`,
          // Clicking the row expands its plans.
          cell: ({ row }) => (
            <div className="flex flex-col gap-0">
              <span className="text-sm font-medium">
                <Highlight
                  text={row.original.partReadableId}
                  ranges={searchMatches(row.original.partReadableId, search)}
                />
              </span>
              <span className="text-xs text-muted-foreground">
                <Highlight
                  text={row.original.partName}
                  ranges={searchMatches(row.original.partName, search)}
                />
              </span>
            </div>
          ),
          meta: {
            mobile: "P1",
            icon: <LuBookMarked />,
            filter: {
              type: "static" as const,
              options: items?.map((item) => ({
                value: item.readableIdWithRevision,
                label: item.readableIdWithRevision
              }))
            }
          }
        },
        {
          accessorKey: "planCount",
          header: t`Inspection Plans`,
          cell: ({ row }) => (
            <span className="tabular-nums">{row.original.planCount}</span>
          ),
          meta: { mobile: "P2", icon: <LuTarget /> }
        },
        {
          accessorKey: "itemPostingGroupId",
          header: t`Item Group`,
          cell: (item) => {
            const itemPostingGroupId = item.getValue<string>();
            const itemPostingGroup = itemPostingGroups.find(
              (group) => group.value === itemPostingGroupId
            );
            return <Enumerable value={itemPostingGroup?.label ?? null} />;
          },
          meta: {
            filter: {
              type: "static" as const,
              options: itemPostingGroups.map((group) => ({
                value: group.value,
                label: <Enumerable value={group.label} />
              }))
            },
            icon: <LuGroup />,
            exportValue: (row) =>
              itemPostingGroups.find(
                (group) => group.value === row.itemPostingGroupId
              )?.label ?? null
          }
        },
        {
          accessorKey: "tags",
          header: t`Tags`,
          cell: ({ row }) => (
            <HStack spacing={0} className="gap-1">
              {row.original.tags?.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </HStack>
          ),
          meta: {
            filter: {
              type: "static" as const,
              options: tags?.map((tag) => ({
                value: tag.name,
                label: <Badge variant="secondary">{tag.name}</Badge>
              })),
              isArray: true
            },
            icon: <LuTag />,
            exportValue: (row) =>
              row.tags?.length ? row.tags.join(", ") : null
          }
        },
        {
          accessorKey: "updatedAt",
          header: t`Updated At`,
          cell: (item) => (
            <DateTime value={item.getValue<string>()} variant="date" />
          ),
          meta: { icon: <LuCalendar /> }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: (item) => (
            <DateTime value={item.getValue<string>()} variant="date" />
          ),
          meta: { icon: <LuCalendar /> }
        },
        // The plans live in the expanded row, which the CSV cannot carry.
        exportOnlyColumn<InspectionPlanPart>({
          id: "planNames",
          header: t`Plan Names`,
          value: (row) => row.plans.map((plan) => plan.name).join(", ")
        })
      ],
      [items, itemPostingGroups, search, tags, t]
    );

    const renderExpandedRow = useCallback(
      (row: InspectionPlanPart) => (
        <div className="pl-[52px] pr-4">
          {row.plans.map((plan) => (
            <div key={plan.id} className="flex gap-3 py-3 text-sm">
              <div
                aria-hidden
                className="w-5 shrink-0 border-l border-border -my-3"
              />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {plan.modelUploadId ? (
                  <LuBox className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <LuFileText className="size-4 shrink-0 text-muted-foreground" />
                )}
                <Hyperlink to={path.to.inspectionDocument(plan.id)}>
                  <span className="font-medium">
                    <Highlight
                      text={plan.name}
                      ranges={searchMatches(plan.name, search)}
                    />
                  </span>
                </Hyperlink>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-muted-foreground">
                <EmployeeAvatar employeeId={plan.createdBy} size="xs" />
                <DateTime value={plan.createdAt} variant="date" />
              </div>
            </div>
          ))}
        </div>
      ),
      [search]
    );

    return (
      <Table<InspectionPlanPart>
        data={data}
        infinite={infinite}
        columns={columns}
        count={count}
        defaultColumnVisibility={defaultColumnVisibility}
        renderExpandedRow={renderExpandedRow}
        expandRowsFor={search}
        primaryAction={
          permissions.can("create", "quality") && (
            <New
              label={t`Inspection Plan`}
              to={`${path.to.newInspectionDocument}?${params?.toString()}`}
            />
          )
        }
        title={t`Inspection Plans`}
      />
    );
  }
);

InspectionDocumentTable.displayName = "InspectionDocumentTable";
export default InspectionDocumentTable;
