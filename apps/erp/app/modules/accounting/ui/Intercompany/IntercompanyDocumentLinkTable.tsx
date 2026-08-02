import { MenuIcon, MenuItem } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBuilding2,
  LuCircleX,
  LuFileText,
  LuRefreshCw,
  LuStar,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Table } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { intercompanyDocumentLinkStatuses } from "../../accounting.models";
import IntercompanyDocumentLinkStatus from "./IntercompanyDocumentLinkStatus";

type IntercompanyDocumentLink = {
  id: string;
  sourceDocumentType: string;
  targetDocumentType: string;
  status: string;
  failureReason: string | null;
  sourceCompany: { name: string } | null;
  targetCompany: { name: string } | null;
};

type IntercompanyDocumentLinkTableProps = {
  data: IntercompanyDocumentLink[];
  count: number;
};

const IntercompanyDocumentLinkTable = memo(
  ({ data, count }: IntercompanyDocumentLinkTableProps) => {
    const { t } = useLingui();
    const permissions = usePermissions();
    const fetcher = useFetcher();

    const columns = useMemo<ColumnDef<IntercompanyDocumentLink>[]>(() => {
      return [
        {
          accessorKey: "sourceCompany",
          header: t`Source`,
          cell: ({ row }) => row.original.sourceCompany?.name ?? "—",
          meta: {
            icon: <LuBuilding2 />
          }
        },
        {
          accessorKey: "sourceDocumentType",
          header: t`Source Document`,
          cell: ({ row }) => row.original.sourceDocumentType,
          meta: {
            icon: <LuFileText />
          }
        },
        {
          accessorKey: "targetCompany",
          header: t`Target`,
          cell: ({ row }) => row.original.targetCompany?.name ?? "—",
          meta: {
            icon: <LuBuilding2 />
          }
        },
        {
          accessorKey: "targetDocumentType",
          header: t`Target Document`,
          cell: ({ row }) => row.original.targetDocumentType,
          meta: {
            icon: <LuFileText />
          }
        },
        {
          accessorKey: "status",
          header: t`Status`,
          cell: ({ row }) => (
            <IntercompanyDocumentLinkStatus
              status={
                row.original
                  .status as (typeof intercompanyDocumentLinkStatuses)[number]
              }
            />
          ),
          meta: {
            filter: {
              type: "static",
              options: intercompanyDocumentLinkStatuses.map((v) => ({
                label: v,
                value: v
              }))
            },
            icon: <LuStar />
          }
        },
        {
          accessorKey: "failureReason",
          header: t`Failure Reason`,
          cell: ({ row }) => (
            <div className="max-w-[280px] truncate text-destructive">
              {row.original.failureReason || "—"}
            </div>
          ),
          meta: {
            icon: <LuTriangleAlert />
          }
        }
      ];
    }, [t]);

    const renderContextMenu = useCallback(
      (row: IntercompanyDocumentLink) => {
        const canUpdate = permissions.can("update", "accounting");
        const canRetry =
          canUpdate && (row.status === "Failed" || row.status === "Exception");
        const canDetach = canUpdate && row.status !== "Detached";
        return (
          <>
            <MenuItem
              disabled={!canRetry}
              onClick={() => {
                fetcher.submit(null, {
                  method: "post",
                  action: `${path.to.intercompanyMirroring}/${row.id}/retry`
                });
              }}
            >
              <MenuIcon icon={<LuRefreshCw />} />
              <Trans>Retry Mirror</Trans>
            </MenuItem>
            <MenuItem
              disabled={!canDetach}
              onClick={() => {
                fetcher.submit(null, {
                  method: "post",
                  action: `${path.to.intercompanyMirroring}/${row.id}/detach`
                });
              }}
            >
              <MenuIcon icon={<LuCircleX />} />
              <Trans>Detach Link</Trans>
            </MenuItem>
          </>
        );
      },
      [permissions, fetcher]
    );

    return (
      <Table<IntercompanyDocumentLink>
        data={data}
        columns={columns}
        count={count}
        renderContextMenu={renderContextMenu}
        title={t`Mirrored Documents`}
      />
    );
  }
);

IntercompanyDocumentLinkTable.displayName = "IntercompanyDocumentLinkTable";
export default IntercompanyDocumentLinkTable;
