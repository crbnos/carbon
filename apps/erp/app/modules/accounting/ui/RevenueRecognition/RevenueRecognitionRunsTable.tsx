import { MenuIcon, MenuItem, useDisclosure } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { LuCalendar, LuEye, LuHash, LuStar, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, Hyperlink, Table } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import type { getRevenueRecognitionRuns } from "~/modules/accounting";
import { path } from "~/utils/path";
import RevenueRecognitionRunStatus from "./RevenueRecognitionRunStatus";

export type RevenueRecognitionRunListItem = NonNullable<
  Awaited<ReturnType<typeof getRevenueRecognitionRuns>>["data"]
>[number];

type RevenueRecognitionRunsTableProps = {
  data: RevenueRecognitionRunListItem[];
  count: number;
  primaryAction?: ReactNode;
};

const RevenueRecognitionRunsTable = memo(
  ({ data, count, primaryAction }: RevenueRecognitionRunsTableProps) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const permissions = usePermissions();
    const [selectedRun, setSelectedRun] =
      useState<RevenueRecognitionRunListItem | null>(null);
    const deleteModal = useDisclosure();

    const columns = useMemo<ColumnDef<RevenueRecognitionRunListItem>[]>(
      () => [
        {
          accessorKey: "runId",
          header: t`Run ID`,
          cell: ({ row }) => (
            <Hyperlink to={path.to.revenueRecognitionRun(row.original.id)}>
              {row.original.runId}
            </Hyperlink>
          ),
          meta: {
            icon: <LuHash />
          }
        },
        {
          accessorKey: "periodEnd",
          header: t`Period End`,
          cell: ({ row }) => (
            <DateTime value={row.original.periodEnd} variant="date" />
          ),
          meta: {
            icon: <LuCalendar />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <RevenueRecognitionRunStatus status={row.original.status} />
          ),
          meta: {
            icon: <LuStar />
          }
        },
        {
          accessorKey: "postedAt",
          header: t`Posted At`,
          cell: ({ row }) =>
            row.original.postedAt ? (
              <DateTime value={row.original.postedAt} variant="date" />
            ) : (
              "—"
            ),
          meta: {
            icon: <LuCalendar />
          }
        }
      ],
      [t]
    );

    const renderContextMenu = useCallback(
      (row: RevenueRecognitionRunListItem) => (
        <>
          <MenuItem
            disabled={!permissions.can("view", "accounting")}
            onClick={() => navigate(path.to.revenueRecognitionRun(row.id))}
          >
            <MenuIcon icon={<LuEye />} />
            <Trans>View Run</Trans>
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
              <Trans>Delete</Trans>
            </MenuItem>
          )}
        </>
      ),
      [deleteModal, navigate, permissions]
    );

    return (
      <>
        <Table<RevenueRecognitionRunListItem>
          data={data}
          columns={columns}
          count={count}
          primaryAction={primaryAction}
          renderContextMenu={renderContextMenu}
          title={t`Revenue Recognition`}
        />
        {selectedRun && (
          <ConfirmDelete
            action={path.to.deleteRevenueRecognitionRun(selectedRun.id)}
            isOpen={deleteModal.isOpen}
            name={selectedRun.runId}
            text={t`Are you sure you want to delete ${selectedRun.runId}? This cannot be undone.`}
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

RevenueRecognitionRunsTable.displayName = "RevenueRecognitionRunsTable";
export default RevenueRecognitionRunsTable;
