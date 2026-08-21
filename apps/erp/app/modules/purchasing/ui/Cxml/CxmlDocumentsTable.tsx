import { formatDateTime } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuArrowDownUp,
  LuCalendar,
  LuFileCode,
  LuHash,
  LuLink,
  LuTruck
} from "react-icons/lu";
import { Hyperlink, Table } from "~/components";
import { path } from "~/utils/path";
import type { CxmlDocument } from "../../types";
import { CxmlDocumentStatus } from "./CxmlDocumentStatus";

type CxmlDocumentsTableProps = {
  data: CxmlDocument[];
  count: number;
};

const CxmlDocumentsTable = memo(({ data, count }: CxmlDocumentsTableProps) => {
  const { t } = useLingui();

  const columns = useMemo<ColumnDef<CxmlDocument>[]>(
    () => [
      {
        accessorKey: "documentType",
        header: t`Type`,
        cell: ({ row }) => (
          <Hyperlink to={path.to.cxmlDocument(row.original.id)}>
            {row.original.documentType}
          </Hyperlink>
        ),
        meta: { icon: <LuFileCode /> }
      },
      {
        accessorKey: "direction",
        header: t`Direction`,
        cell: ({ row }) => row.original.direction,
        meta: { icon: <LuArrowDownUp /> }
      },
      {
        accessorKey: "status",
        header: t`Status`,
        cell: ({ row }) => <CxmlDocumentStatus status={row.original.status} />,
        meta: { icon: <LuHash /> }
      },
      {
        accessorKey: "purchaseOrderId",
        header: t`Purchase Order`,
        cell: ({ row }) =>
          row.original.purchaseOrderId ? (
            <Hyperlink to={path.to.purchaseOrder(row.original.purchaseOrderId)}>
              {row.original.purchaseOrderId}
            </Hyperlink>
          ) : (
            "—"
          ),
        meta: { icon: <LuLink /> }
      },
      {
        accessorKey: "externalId",
        header: t`External ID`,
        cell: ({ row }) => row.original.externalId ?? "—",
        meta: { icon: <LuTruck /> }
      },
      {
        accessorKey: "createdAt",
        header: t`Received`,
        cell: ({ row }) =>
          row.original.createdAt ? formatDateTime(row.original.createdAt) : "—",
        meta: { icon: <LuCalendar /> }
      }
    ],
    [t]
  );

  return (
    <Table<CxmlDocument>
      data={data}
      columns={columns}
      count={count}
      title={t`Documents`}
      table="cxmlDocument"
      withPagination
    />
  );
});

CxmlDocumentsTable.displayName = "CxmlDocumentsTable";
export default CxmlDocumentsTable;
