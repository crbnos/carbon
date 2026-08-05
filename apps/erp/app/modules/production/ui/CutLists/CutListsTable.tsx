import { MenuIcon, MenuItem } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuCalendar,
  LuChartLine,
  LuMapPin,
  LuPencil,
  LuRuler,
  LuScissors,
  LuTrash,
  LuUser
} from "react-icons/lu";
import { TbRoute } from "react-icons/tb";
import { useNavigate } from "react-router";
import { EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions, useUrlParams } from "~/hooks";
import { path } from "~/utils/path";
import type { CutList } from "../../types";
import CutListStatus from "./CutListStatus";

type CutListsTableProps = {
  data: CutList[];
  count: number;
};

const CutListsTable = memo(({ data, count }: CutListsTableProps) => {
  const [params] = useUrlParams();
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();

  const columns = useMemo<ColumnDef<CutList>[]>(() => {
    return [
      {
        accessorKey: "cutListId",
        header: t`Cut List`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.cutList(row.original.id!)}>
            {row.original.cutListId}
          </Hyperlink>
        ),
        meta: { icon: <LuScissors /> }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <CutListStatus status={row.original.status} />,
        meta: { icon: <LuCalendar /> }
      },
      {
        accessorKey: "processName",
        header: t`Process`,
        cell: ({ row }) => <Enumerable value={row.original.processName} />,
        meta: { icon: <TbRoute /> }
      },
      {
        accessorKey: "locationName",
        header: t`Location`,
        cell: ({ row }) => <Enumerable value={row.original.locationName} />,
        meta: { icon: <LuMapPin /> }
      },
      {
        id: "pieces",
        header: t`Pieces`,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.totalPiecesCut ?? 0} / {row.original.totalPieces ?? 0}
          </span>
        ),
        meta: { icon: <LuRuler /> }
      },
      {
        accessorKey: "actualYieldPct",
        header: t`Yield`,
        cell: ({ row }) => {
          // Actual once the run is confirmed; until then the plan's estimate.
          const actual = row.original.actualYieldPct;
          const planned = row.original.plannedYieldPct;
          const value = actual ?? planned;
          if (value === null || value === undefined) return null;
          return (
            <span className="tabular-nums">
              {Number(value).toFixed(1)}%
              {actual === null || actual === undefined ? (
                <span className="text-muted-foreground text-xs ml-1">
                  {t`planned`}
                </span>
              ) : null}
            </span>
          );
        },
        meta: { icon: <LuChartLine /> }
      },
      {
        accessorKey: "assignee",
        header: t`Assignee`,
        cell: ({ row }) => (
          <EmployeeAvatar employeeId={row.original.assignee} />
        ),
        meta: { icon: <LuUser /> }
      }
    ];
  }, [t]);

  const renderContextMenu = useCallback(
    (row: CutList) => {
      return (
        <>
          <MenuItem
            onClick={() => {
              navigate(path.to.cutList(row.id!));
            }}
          >
            <MenuIcon icon={<LuPencil />} />
            Edit Cut List
          </MenuItem>
          <MenuItem
            destructive
            disabled={!permissions.can("delete", "production")}
            onClick={() => {
              navigate(
                `${path.to.deleteCutList(row.id!)}?${params.toString()}`
              );
            }}
          >
            <MenuIcon icon={<LuTrash />} />
            Delete Cut List
          </MenuItem>
        </>
      );
    },
    [navigate, params, permissions]
  );

  return (
    <Table<CutList>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "production") && (
          <New
            label={t`Cut List`}
            to={`${path.to.newCutList}?${params.toString()}`}
          />
        )
      }
      renderContextMenu={renderContextMenu}
      title={t`Cut Lists`}
      table="cutList"
      withSavedView
    />
  );
});

CutListsTable.displayName = "CutListsTable";
export default CutListsTable;
