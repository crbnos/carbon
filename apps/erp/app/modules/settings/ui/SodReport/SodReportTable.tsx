import { Badge } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { LuInfo, LuTriangleAlert, LuUser, LuWorkflow } from "react-icons/lu";
import { Table } from "~/components";
import type { SodConflict } from "~/modules/settings";

type SodReportTableProps = {
  data: SodConflict[];
  count: number;
};

const SodReportTable = memo(({ data, count }: SodReportTableProps) => {
  const { t } = useLingui();

  const columns = useMemo<ColumnDef<SodConflict>[]>(() => {
    return [
      {
        accessorKey: "type",
        header: t`Conflict`,
        cell: (item) => item.getValue(),
        meta: { icon: <LuWorkflow /> }
      },
      {
        accessorKey: "severity",
        header: t`Severity`,
        cell: (item) => {
          const severity = item.getValue<SodConflict["severity"]>();
          return severity === "warning" ? (
            <Badge variant="yellow">{t`Warning`}</Badge>
          ) : (
            <Badge variant="blue">{t`Info`}</Badge>
          );
        },
        meta: {
          icon: <LuTriangleAlert />,
          filter: {
            type: "static",
            options: [
              { value: "warning", label: t`Warning` },
              { value: "info", label: t`Info` }
            ]
          }
        }
      },
      {
        accessorKey: "subject",
        header: t`Subject`,
        cell: (item) => item.getValue(),
        meta: { icon: <LuUser /> }
      },
      {
        accessorKey: "detail",
        header: t`Detail`,
        cell: (item) => item.getValue(),
        meta: { icon: <LuInfo /> }
      }
    ];
  }, [t]);

  return (
    <Table<SodConflict>
      count={count}
      columns={columns}
      data={data}
      title={t`Segregation of Duties`}
    />
  );
});

SodReportTable.displayName = "SodReportTable";

export default SodReportTable;
