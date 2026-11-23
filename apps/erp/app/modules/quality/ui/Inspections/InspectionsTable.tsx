// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Badge, MENU_ITEM_SHORTCUTS, MenuIcon, MenuItem } from "@carbon/react";
import { getItemReadableId } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo, useState } from "react";
import {
  LuBlocks,
  LuBookMarked,
  LuCalendar,
  LuCircleX,
  LuClipboardCheck,
  LuExternalLink,
  LuFactory,
  LuHash,
  LuTrash,
  LuTruck,
  LuUser
} from "react-icons/lu";
import { useNavigate } from "react-router";
import {
  DateTime,
  EmployeeAvatar,
  exportOnlyColumn,
  Hyperlink,
  New,
  Table
} from "~/components";
import type { InfiniteOptions } from "~/components/Table";
import { usePermissions, useUrlParams } from "~/hooks";
import {
  inspectionSourceDocuments,
  inspectionStatusType
} from "~/modules/quality/quality.models";
import type { Inspection } from "~/modules/quality/types";
import { useItems } from "~/stores/items";
import { path } from "~/utils/path";
import { getInspectionStatusVariant } from "./InspectionStatus";
import {
  canCancelInspection,
  canDeleteInspection,
  type ManualInspectionAction,
  ManualInspectionConfirm
} from "./ManualInspectionConfirm";

type InspectionsTableProps = {
  data: Inspection[];
  count: number;
  infinite: InfiniteOptions;
};

function computeProgress(row: Inspection): {
  inspected: number;
  total: number;
} {
  // The list loader selects `inspectionSample(status)` as an array of
  // child rows; count the non-Pending ones.
  const inspected = (row.inspectionSample ?? []).filter(
    (s) => s.status !== "Pending"
  ).length;
  return { inspected, total: row.sampleSize ?? 0 };
}

const InspectionsTable = memo((props: InspectionsTableProps) => {
  const { data, count, infinite } = props;
  const { t } = useLingui();
  const [params] = useUrlParams();
  const [items] = useItems();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [pending, setPending] = useState<{
    action: ManualInspectionAction;
    row: Inspection;
  } | null>(null);

  const renderContextMenu = useCallback(
    (row: Inspection) => {
      const isManual = row.sourceDocument === "Manual";
      // The rule InspectionView applies: nothing recorded, no measurement.
      const measurementCount = row.inspectionMeasurement?.[0]?.count ?? 0;
      return (
        <>
          <MenuItem
            shortcut={MENU_ITEM_SHORTCUTS.view}
            onClick={() =>
              navigate(`${path.to.inspection(row.id)}?${params.toString()}`)
            }
          >
            <MenuIcon icon={<LuExternalLink />} />
            {t`View Inspection`}
          </MenuItem>
          {isManual && (
            <MenuItem
              disabled={
                !permissions.can("update", "quality") ||
                !canCancelInspection(row)
              }
              onClick={() => setPending({ action: "cancel", row })}
            >
              <MenuIcon icon={<LuCircleX />} />
              {t`Cancel Inspection`}
            </MenuItem>
          )}
          {isManual && (
            <MenuItem
              shortcut={MENU_ITEM_SHORTCUTS.delete}
              destructive
              disabled={
                !permissions.can("delete", "quality") ||
                !canDeleteInspection(row, row.inspectionSample ?? []) ||
                measurementCount > 0
              }
              onClick={() => setPending({ action: "delete", row })}
            >
              <MenuIcon icon={<LuTrash />} />
              {t`Delete Inspection`}
            </MenuItem>
          )}
        </>
      );
    },
    [navigate, params, permissions, t]
  );

  const columns = useMemo<ColumnDef<Inspection>[]>(() => {
    return [
      {
        accessorKey: "inspectionId",
        header: t`Inspection`,
        cell: ({ row }) => (
          <Hyperlink
            to={`${path.to.inspection(row.original.id!)}?${params.toString()}`}
          >
            {row.original.inspectionId}
          </Hyperlink>
        ),
        meta: {
          mobile: "P1",
          icon: <LuBookMarked />
        }
      },
      {
        accessorKey: "itemId",
        header: t`Item`,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0">
            <span className="text-sm font-medium max-md:text-[0.8125rem] max-md:font-normal">
              {getItemReadableId(items, row.original.itemId) ??
                row.original.itemReadableId ??
                ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.item?.name}
            </span>
          </div>
        ),
        meta: {
          mobile: "P3",
          icon: <LuBookMarked />,
          filter: {
            type: "static",
            options: items.map((item) => ({
              value: item.id,
              label: item.readableIdWithRevision
            }))
          },
          // Without this the exporter substitutes the item's name for the id
          // (Download.tsx idNameMaps), losing the readable id the cell shows.
          exportValue: (row) =>
            getItemReadableId(items, row.itemId) ?? row.itemReadableId ?? null
        }
      },
      exportOnlyColumn<Inspection>({
        id: "itemName",
        header: t`Item Name`,
        value: (row) => row.item?.name ?? null
      }),
      {
        accessorKey: "sourceDocument",
        header: t`Source`,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0 text-sm">
            <span>
              {row.original.sourceDocumentReadableId ??
                row.original.sourceDocument}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.supplier?.name ?? row.original.sourceDocument}
            </span>
          </div>
        ),
        meta: {
          icon: <LuTruck />,
          filter: {
            type: "static",
            options: inspectionSourceDocuments.map((source) => ({
              value: source,
              label: source
            }))
          },
          exportValue: (row) =>
            row.sourceDocumentReadableId ?? row.sourceDocument ?? null
        }
      },
      {
        accessorKey: "lotSize",
        header: t`Lot Size`,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.lotSize ?? 0}</span>
        ),
        meta: { mobile: "P2", mobileLabel: true, icon: <LuBlocks /> }
      },
      {
        accessorKey: "sampleSize",
        header: t`Sample`,
        cell: ({ row }) => {
          const p = computeProgress(row.original);
          return (
            <span className="text-sm">
              {p.inspected} / {p.total}
            </span>
          );
        },
        meta: { icon: <LuHash /> }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => (
          <Badge variant={getInspectionStatusVariant(row.original.status)}>
            {row.original.status}
          </Badge>
        ),
        meta: {
          mobile: "P2",
          icon: <LuClipboardCheck />,
          filter: {
            type: "static",
            options: inspectionStatusType.map((s) => ({
              value: s,
              label: <Badge variant={getInspectionStatusVariant(s)}>{s}</Badge>
            }))
          }
        }
      },
      {
        accessorKey: "workCenterId",
        header: t`Work Center`,
        cell: ({ row }) => (
          <span className="text-sm">{row.original.workCenter?.name ?? ""}</span>
        ),
        meta: {
          icon: <LuFactory />,
          exportValue: (row) => row.workCenter?.name ?? null
        }
      },
      {
        accessorKey: "assignee",
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: { icon: <LuUser /> }
      },
      {
        accessorKey: "createdBy",
        header: t`Created By`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.createdBy} />
        ),
        meta: { icon: <LuBlocks /> }
      },
      {
        accessorKey: "createdAt",
        header: t`Created At`,
        cell: ({ row }) => (
          <DateTime value={row.original.createdAt} variant="date" />
        ),
        meta: { icon: <LuCalendar /> }
      }
    ];
  }, [items, t, params]);

  return (
    <>
      <Table<Inspection>
        data={data}
        infinite={infinite}
        columns={columns}
        count={count ?? 0}
        primaryAction={
          permissions.can("create", "quality") && (
            <New
              label={t`Inspection`}
              to={`${path.to.newInspection}?${params.toString()}`}
            />
          )
        }
        renderContextMenu={renderContextMenu}
        title={t`Inspections`}
        table="inspection"
        withSavedView
      />
      {pending && (
        <ManualInspectionConfirm
          action={pending.action}
          lot={pending.row}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
});

InspectionsTable.displayName = "InspectionsTable";
export default InspectionsTable;
