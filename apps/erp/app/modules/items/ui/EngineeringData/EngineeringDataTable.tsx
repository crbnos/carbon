import { Trans, useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuAtom,
  LuCircleGauge,
  LuClock,
  LuComponent,
  LuGitCommitVertical,
  LuTruck,
  LuWeight
} from "react-icons/lu";
import { Link } from "react-router";
import { Hyperlink, Table } from "~/components";
import { OnshapeStatus } from "~/components/Icons";
import { useDateFormatter } from "~/hooks";
import { path } from "~/utils/path";
import type { OnshapeEngineeringDataRow } from "../../types";
import { getLinkToItemDetails } from "../Item/ItemForm";

type EngineeringDataTableProps = {
  data: OnshapeEngineeringDataRow[];
  count: number;
};

const Empty = () => <span className="text-muted-foreground">—</span>;

/**
 * Every part whose engineering data has been pulled from CAD: its release state
 * and the mass, material and vendor read off the BOM. The two freshness columns
 * are separate on purpose — the release state and the rest of the row are
 * refreshed by different paths, so one can be current while the other is not.
 */
const EngineeringDataTable = memo(
  ({ data, count }: EngineeringDataTableProps) => {
    const { t } = useLingui();
    const { formatRelativeTime } = useDateFormatter();

    const columns = useMemo<ColumnDef<OnshapeEngineeringDataRow>[]>(() => {
      return [
        {
          accessorKey: "readableId",
          header: t`Part`,
          cell: ({ row }) => {
            if (!row.original.readableId || !row.original.itemId) {
              return <Empty />;
            }
            return (
              <Hyperlink to={getLinkToItemDetails("Part", row.original.itemId)}>
                <div className="flex flex-col gap-0">
                  <span className="text-sm font-medium">
                    {row.original.readableId}
                  </span>
                  {row.original.name && (
                    <span className="text-xs text-muted-foreground">
                      {row.original.name}
                    </span>
                  )}
                </div>
              </Hyperlink>
            );
          },
          meta: {
            icon: <LuComponent />,
            exportValue: (row) => row.readableId
          }
        },
        {
          accessorKey: "revision",
          header: t`Revision`,
          cell: ({ row }) => row.original.revision ?? <Empty />,
          meta: {
            icon: <LuGitCommitVertical />
          }
        },
        {
          accessorKey: "releaseState",
          header: t`Release State`,
          cell: ({ row }) =>
            row.original.releaseState ? (
              <OnshapeStatus status={row.original.releaseState} />
            ) : (
              <Empty />
            ),
          meta: {
            icon: <LuCircleGauge />,
            exportValue: (row) => row.releaseState
          }
        },
        {
          accessorKey: "mass",
          header: t`Mass`,
          cell: ({ row }) => row.original.mass ?? <Empty />,
          meta: {
            icon: <LuWeight />
          }
        },
        {
          accessorKey: "material",
          header: t`Material`,
          cell: ({ row }) => row.original.material ?? <Empty />,
          meta: {
            icon: <LuAtom />
          }
        },
        {
          accessorKey: "vendor",
          header: t`Vendor`,
          cell: ({ row }) => row.original.vendor ?? <Empty />,
          meta: {
            icon: <LuTruck />
          }
        },
        {
          accessorKey: "bomSyncedAt",
          header: t`Data synced`,
          cell: ({ row }) =>
            row.original.bomSyncedAt ? (
              formatRelativeTime(row.original.bomSyncedAt)
            ) : (
              <Empty />
            ),
          meta: {
            icon: <LuClock />,
            exportValue: (row) => row.bomSyncedAt
          }
        },
        {
          accessorKey: "stateSyncedAt",
          header: t`State synced`,
          cell: ({ row }) =>
            row.original.stateSyncedAt ? (
              formatRelativeTime(row.original.stateSyncedAt)
            ) : (
              <Empty />
            ),
          meta: {
            icon: <LuClock />,
            exportValue: (row) => row.stateSyncedAt
          }
        }
      ];
    }, [formatRelativeTime, t]);

    return (
      <Table<OnshapeEngineeringDataRow>
        data={data}
        columns={columns}
        count={count}
        emptyState={
          <span className="text-sm text-muted-foreground">
            <Trans>
              Run a BOM sync from a part's{" "}
              <Link className="underline" to={path.to.parts}>
                BoM Explorer
              </Link>{" "}
              to populate this table
            </Trans>
          </span>
        }
        title={t`Engineering Data`}
      />
    );
  }
);

EngineeringDataTable.displayName = "EngineeringDataTable";
export default EngineeringDataTable;
