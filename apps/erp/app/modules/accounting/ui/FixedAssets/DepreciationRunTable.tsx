import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { formatDate } from "@carbon/utils";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { LuCalendar, LuEye, LuHash, LuStar, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Hyperlink, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import type { DepreciationRunListItem } from "../../types";
import DepreciationRunStatus from "./DepreciationRunStatus";

type DepreciationRunTableProps = {
  data: DepreciationRunListItem[];
  count: number;
  primaryAction?: ReactNode;
};

const DepreciationRunTable = memo(
  ({ data, count, primaryAction }: DepreciationRunTableProps) => {
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [selectedRun, setSelectedRun] =
      useState<DepreciationRunListItem | null>(null);
    const deleteModal = useDisclosure();

    const columns = useMemo<ColumnDef<DepreciationRunListItem>[]>(
      () => [
        {
          accessorKey: "depreciationRunId",
          header: "Run ID",
          cell: ({ row }) => (
            <Hyperlink to={path.to.depreciationRun(row.original.id)}>
              {row.original.depreciationRunId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "periodEnd",
          header: "Period End",
          cell: ({ row }) => formatDate(row.original.periodEnd),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "status",
          header: "Status",
          cell: ({ row }) => (
            <DepreciationRunStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuStar />
          }
        },
        {
          accessorKey: "postedAt",
          header: "Posted At",
          cell: ({ row }) =>
            row.original.postedAt ? formatDate(row.original.postedAt) : "—",
          meta: {
            icon: <LuCalendar />
          }
        }
      ],
      []
    );

    const renderContextMenu = useCallback(
      (row: DepreciationRunListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("view", "accounting")}
            onClick={() => navigate(path.to.depreciationRun(row.id))}
          >
            <MenuIcon icon={<LuEye />} />
            View Run
          </MenuItem>
          {row.status === "Draft" && (
            <MenuItem
              disabled={!permissions.can("delete", "accounting")}
              destructive
              onClick={() => {
                setSelectedRun(row);
                deleteModal.onOpen();
              }}
            >
              <MenuIcon icon={<LuTrash />} />
              Delete
            </MenuItem>
          )}
        </>
      ),
      [deleteModal, navigate, permissions]
    );

    return (
      <>
        <Table<DepreciationRunListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title="Depreciation"
        />
        {selectedRun && (
          <ConfirmDelete
            action={path.to.deleteDepreciationRun(selectedRun.id)}
            isOpen={deleteModal.isOpen}
            name={selectedRun.depreciationRunId}
            text={`Are you sure you want to delete ${selectedRun.depreciationRunId}? This cannot be undone.`}
            onCancel={() => {
              deleteModal.onClose();
              setSelectedRun(null);
            }}
            onSubmit={() => {
              deleteModal.onClose();
              setSelectedRun(null);
            }}
          />
        )}
      </>
    );
  }
);

DepreciationRunTable.displayName = "DepreciationRunTable";
export default DepreciationRunTable;
