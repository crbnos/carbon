import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuBookMarked,
  LuCalendar,
  LuClipboardCheck,
  LuFileCheck,
  LuHash,
  LuLayers,
  LuUser
} from "react-icons/lu";
import { DateTime, EmployeeAvatar, Hyperlink, New, Table } from "~/components";
import { usePermissions } from "~/hooks";
import { firstArticleInspectionStatuses } from "~/modules/quality/quality.models";
import type { FirstArticleInspectionListItem } from "~/modules/quality/types";
import { path } from "~/utils/path";
import { getInspectionStatusVariant } from "../Inspections/InspectionStatus";
import FirstArticleStatus from "./FirstArticleStatus";
import { useFirstArticleLabels } from "./useFirstArticleLabels";

type FirstArticlesTableProps = {
  data: FirstArticleInspectionListItem[];
  count: number;
};

const FirstArticlesTable = memo(({ data, count }: FirstArticlesTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const labels = useFirstArticleLabels();

  const columns = useMemo<ColumnDef<FirstArticleInspectionListItem>[]>(
    () => [
      {
        id: "fairIdentifier",
        header: t`FAIR`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.firstArticle(row.original.id)}>
            {row.original.inspection?.inspectionId ?? ""}
          </Hyperlink>
        ),
        meta: { icon: <LuBookMarked /> }
      },
      {
        accessorKey: "partNumber",
        header: t`Part`,
        cell: ({ row }) => (
          <div className="flex flex-col gap-0">
            <span className="text-sm font-medium">
              {row.original.item?.readableIdWithRevision ??
                row.original.partNumber}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.original.partName}
            </span>
          </div>
        ),
        meta: { icon: <LuLayers /> }
      },
      {
        accessorKey: "partRevision",
        header: t`Revision`,
        cell: ({ row }) => row.original.partRevision ?? "",
        meta: { icon: <LuHash /> }
      },
      {
        id: "job",
        header: t`Job`,
        cell: ({ row }) =>
          row.original.jobId && row.original.job?.jobId ? (
            <Hyperlink to={path.to.job(row.original.jobId)}>
              {row.original.job.jobId}
            </Hyperlink>
          ) : null,
        meta: { icon: <LuFileCheck /> }
      },
      {
        accessorKey: "scope",
        header: t`Scope`,
        cell: ({ row }) => labels.scope(row.original.scope),
        meta: { icon: <LuLayers /> }
      },
      {
        id: "lotStatus",
        header: t`Inspection`,
        cell: ({ row }) =>
          row.original.inspection?.status ? (
            <Badge
              variant={getInspectionStatusVariant(
                row.original.inspection.status
              )}
            >
              {row.original.inspection.status}
            </Badge>
          ) : null,
        meta: { icon: <LuClipboardCheck /> }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <FirstArticleStatus status={row.original.status} />,
        meta: {
          icon: <LuClipboardCheck />,
          filter: {
            type: "static",
            options: firstArticleInspectionStatuses.map((status) => ({
              value: status,
              label: <FirstArticleStatus status={status} />
            }))
          },
          exportValue: (row) => labels.status(row.status)
        }
      },
      {
        accessorKey: "verifiedBy",
        header: t`Verified By`,
        cell: ({ row }) =>
          row.original.verifiedBy ? (
            <EmployeeAvatar employeeId={row.original.verifiedBy} />
          ) : null,
        meta: { icon: <LuUser /> }
      },
      {
        accessorKey: "approvedBy",
        header: t`Approved By`,
        cell: ({ row }) =>
          row.original.approvedBy ? (
            <EmployeeAvatar employeeId={row.original.approvedBy} />
          ) : null,
        meta: { icon: <LuUser /> }
      },
      {
        accessorKey: "createdAt",
        header: t`Created`,
        cell: ({ row }) => (
          <DateTime value={row.original.createdAt} variant="date" />
        ),
        meta: { icon: <LuCalendar /> }
      }
    ],
    [t, labels]
  );

  return (
    <Table<FirstArticleInspectionListItem>
      data={data}
      columns={columns}
      count={count}
      primaryAction={
        permissions.can("create", "quality") && (
          <New label={t`First Article`} to={path.to.newFirstArticle} />
        )
      }
      title={t`First Articles`}
    />
  );
});

FirstArticlesTable.displayName = "FirstArticlesTable";
export default FirstArticlesTable;
