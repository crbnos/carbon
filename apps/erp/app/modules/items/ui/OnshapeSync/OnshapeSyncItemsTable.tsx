import { MenuIcon, MenuItem, toast } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useEffect, useMemo } from "react";
import {
  LuBox,
  LuCircleGauge,
  LuClock,
  LuComponent,
  LuMessageSquareWarning,
  LuRefreshCw,
  LuUser,
  LuZap
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { EmployeeAvatar, Hyperlink, Table } from "~/components";
import { useDateFormatter, usePermissions, useUrlParams } from "~/hooks";
import type { ItemType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { OnshapeSyncItemState } from "../../types";
import { getLinkToItemDetails } from "../Item/ItemForm";
import {
  asOnshapeSyncStatus,
  OnshapeSyncStatusChip,
  onshapeSyncStatuses,
  useOnshapeSyncLabels
} from "../Item/OnshapeSyncPresentation";

type OnshapeSyncItemsTableProps = {
  data: OnshapeSyncItemState[];
  count: number;
};

/**
 * Every part × asset the Onshape sync has touched: how it fared, where it came
 * from, and — for a part whose model never made it — the re-pull. The full error
 * text lives in the expanded row, so nothing essential is tooltip-only.
 */
const OnshapeSyncItemsTable = memo(
  ({ data, count }: OnshapeSyncItemsTableProps) => {
    const { t } = useLingui();
    const { formatRelativeTime } = useDateFormatter();
    const permissions = usePermissions();
    const { assetKindLabel, skipReasonLabel, sourceLabel, statusLabel } =
      useOnshapeSyncLabels();

    const [params] = useUrlParams();
    const syncFetcher = useFetcher<{ success?: boolean; error?: string }>();

    // A table narrowed to nothing is a different story from a table that has
    // never had anything in it, and it must not claim the sync never ran.
    const isNarrowed =
      params.getAll("filter").length > 0 ||
      Boolean(params.get("search")) ||
      Boolean(params.get("status"));

    useEffect(() => {
      const result = syncFetcher.data;
      if (!result) return;
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.success) {
        toast.success(t`Pulling the latest released CAD from Onshape`);
      }
    }, [syncFetcher.data, t]);

    const columns = useMemo<ColumnDef<OnshapeSyncItemState>[]>(() => {
      return [
        {
          accessorKey: "itemId",
          header: t`Part`,
          cell: ({ row }) => {
            const label =
              row.original.itemReadableId ?? row.original.partNumber ?? null;
            if (!label) return <span className="text-muted-foreground">—</span>;
            return (
              <Hyperlink
                to={getLinkToItemDetails(
                  (row.original.itemType ?? "Part") as ItemType,
                  row.original.itemId
                )}
              >
                <div className="flex flex-col gap-0">
                  <span className="text-sm font-medium">{label}</span>
                  {row.original.itemName && (
                    <span className="text-xs text-muted-foreground">
                      {row.original.itemName}
                    </span>
                  )}
                </div>
              </Hyperlink>
            );
          },
          meta: {
            icon: <LuComponent />,
            exportValue: (row) => row.itemReadableId ?? row.partNumber ?? null
          }
        },
        {
          accessorKey: "assetKind",
          header: t`Asset`,
          cell: ({ row }) => assetKindLabel(row.original.assetKind),
          meta: {
            icon: <LuBox />,
            exportValue: (row) => assetKindLabel(row.assetKind),
            filter: {
              type: "static",
              options: [
                { label: assetKindLabel("model"), value: "model" },
                { label: assetKindLabel("drawing"), value: "drawing" }
              ]
            }
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => {
            const status = asOnshapeSyncStatus(row.original.status);
            return status ? <OnshapeSyncStatusChip status={status} /> : null;
          },
          meta: {
            icon: <LuCircleGauge />,
            exportValue: (row) => {
              const status = asOnshapeSyncStatus(row.status);
              return status ? statusLabel(status) : null;
            },
            filter: {
              type: "static",
              options: onshapeSyncStatuses.map((status) => ({
                label: statusLabel(status),
                value: status
              }))
            }
          }
        },
        {
          accessorKey: "revision",
          header: t`Revision`,
          cell: ({ row }) =>
            row.original.revision ?? (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            icon: <LuBox />
          }
        },
        {
          accessorKey: "source",
          header: t`Source`,
          cell: ({ row }) =>
            sourceLabel(row.original.source) ?? (
              <span className="text-muted-foreground">—</span>
            ),
          meta: {
            icon: <LuZap />,
            exportValue: (row) => sourceLabel(row.source)
          }
        },
        {
          id: "reason",
          header: t`Reason`,
          cell: ({ row }) => <ReasonCell row={row.original} />,
          meta: {
            icon: <LuMessageSquareWarning />,
            filterHeader: t`Reason`,
            exportValue: (row) => readReason(row, skipReasonLabel)
          }
        },
        {
          accessorKey: "updatedAt",
          header: t`Last synced`,
          cell: ({ row }) => {
            const syncedAt = row.original.updatedAt ?? row.original.createdAt;
            return formatRelativeTime(syncedAt);
          },
          meta: {
            icon: <LuClock />,
            exportValue: (row) => row.updatedAt ?? row.createdAt
          }
        },
        {
          accessorKey: "updatedBy",
          header: t`Synced by`,
          cell: ({ row }) => (
            <EmployeeAvatar
              employeeId={row.original.updatedBy ?? row.original.createdBy}
            />
          ),
          meta: {
            icon: <LuUser />
          }
        }
      ];
    }, [
      assetKindLabel,
      formatRelativeTime,
      skipReasonLabel,
      sourceLabel,
      statusLabel,
      t
    ]);

    // Only a model row can be re-pulled on demand, and only one that did not
    // land: a drawing is re-exported from identifiers a previous sync saved, and
    // a synced row has nothing to retry.
    const canSyncAgain = useCallback(
      (row: OnshapeSyncItemState) =>
        row.assetKind === "model" &&
        (row.status === "failed" || row.status === "skipped") &&
        permissions.can("update", "parts"),
      [permissions]
    );

    const renderContextMenu = useCallback(
      (row: OnshapeSyncItemState) => {
        if (!canSyncAgain(row)) return null;
        return (
          <MenuItem
            onClick={() =>
              syncFetcher.submit(new FormData(), {
                method: "post",
                action: path.to.api.onShapeItemSync(row.itemId)
              })
            }
          >
            <MenuIcon icon={<LuRefreshCw />} />
            <Trans>Sync again</Trans>
          </MenuItem>
        );
      },
      [canSyncAgain, syncFetcher]
    );

    const renderExpandedRow = useCallback(
      (row: OnshapeSyncItemState) => (
        <div className="px-8 py-3 text-xs text-muted-foreground whitespace-pre-wrap">
          {row.error}
        </div>
      ),
      []
    );

    return (
      <Table<OnshapeSyncItemState>
        data={data}
        columns={columns}
        count={count}
        emptyState={
          <span className="text-sm text-muted-foreground">
            {isNarrowed ? (
              <Trans>No items match these filters</Trans>
            ) : (
              <Trans>
                No synced items yet — run a sync to populate this table
              </Trans>
            )}
          </span>
        }
        renderContextMenu={renderContextMenu}
        renderExpandedRow={renderExpandedRow}
        canExpandRow={(row) => Boolean(row.error)}
        title={t`Items`}
      />
    );
  }
);

// The short, visible reason a row is not simply synced: why it was skipped, the
// first line of an error, or the confirmation that an attachment was already
// there.
function readReason(
  row: OnshapeSyncItemState,
  skipReasonLabel: (reason: string | null | undefined) => string
): string | null {
  if (row.status === "skipped") return skipReasonLabel(row.skipReason);
  if (row.status === "failed" && row.error) return row.error;
  return null;
}

function ReasonCell({ row }: { row: OnshapeSyncItemState }) {
  const { skipReasonLabel, observedOnlyLabel } = useOnshapeSyncLabels();
  const reason = readReason(row, skipReasonLabel);

  if (!reason) {
    return row.observedOnly ? (
      <span className="text-muted-foreground">{observedOnlyLabel}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }

  return (
    <span className="line-clamp-1 text-left text-muted-foreground">
      {reason}
    </span>
  );
}

OnshapeSyncItemsTable.displayName = "OnshapeSyncItemsTable";
export default OnshapeSyncItemsTable;
