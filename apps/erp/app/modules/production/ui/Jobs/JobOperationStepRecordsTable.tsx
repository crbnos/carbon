import type { Database } from "@carbon/database";
import { Checkbox, cn } from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import {
  LuCalendar,
  LuClipboardList,
  LuFileText,
  LuList,
  LuPaperclip,
  LuSettings,
  LuUser
} from "react-icons/lu";
import { useParams } from "react-router";
import { EmployeeAvatar, Table } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ProcedureStepTypeIcon } from "~/components/Icons";
import { useDateFormatter } from "~/hooks";
import { procedureStepType } from "~/modules/shared/shared.models";
import { usePeople } from "~/stores";
import { getPrivateUrl } from "~/utils/path";

type JobOperationStepRecord = {
  id: string;
  jobOperationStepId: string;
  index: number;
  type: Database["public"]["Enums"]["procedureStepType"];
  name: string;
  value: string | null;
  numericValue: number | null;
  booleanValue: boolean | null;
  userValue: string | null;
  unitOfMeasureCode: string | null;
  minValue: number | null;
  maxValue: number | null;
  operationId: string;
  operationDescription: string | null;
  operationOrder: number | null;
  itemId: string | null;
  itemReadableId: string | null;
  companyId: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string | null;
};

type JobOperationStepRecordsTableProps = {
  data: JobOperationStepRecord[];
  count: number;
};

const JobOperationStepRecordsTable = memo(
  ({ data, count }: JobOperationStepRecordsTableProps) => {
    const { jobId } = useParams();
    const { t } = useLingui();
    if (!jobId) throw new Error("Job ID is required");
    const { formatDateTime } = useDateFormatter();

    const numberFormatter = useNumberFormatter();
    const unitOfMeasures = useUnitOfMeasure();
    const [employees] = usePeople();

    const columns = useMemo<ColumnDef<JobOperationStepRecord>[]>(() => {
      return [
        {
          accessorKey: "operationDescription",
          header: t`Operation`,
          cell: ({ row }) => row.original.operationDescription,
          meta: {
            icon: <LuSettings />
          }
        },
        {
          accessorKey: "name",
          header: t`Step`,
          cell: ({ row }) => row.original.name,
          meta: {
            icon: <LuClipboardList />
          }
        },
        {
          id: "value",
          header: t`Value`,
          cell: ({ row }) => {
            const record = row.original;

            switch (record.type) {
              case "Task":
              case "Checkbox":
                return <Checkbox checked={record.booleanValue ?? false} />;
              case "Value":
                return <p className="text-sm">{record.value}</p>;
              case "Measurement":
                if (typeof record.numericValue === "number") {
                  return (
                    <p
                      className={cn(
                        "text-sm",
                        record.minValue !== null &&
                          record.minValue !== undefined &&
                          record.numericValue < record.minValue &&
                          "text-red-500",
                        record.maxValue !== null &&
                          record.maxValue !== undefined &&
                          record.numericValue > record.maxValue &&
                          "text-red-500"
                      )}
                    >
                      {numberFormatter.format(record.numericValue)}{" "}
                      {
                        unitOfMeasures.find(
                          (u) => u.value === record.unitOfMeasureCode
                        )?.label
                      }
                    </p>
                  );
                }
                return null;
              case "Timestamp":
                return (
                  <p className="text-sm">
                    {formatDateTime(record.value ?? "")}
                  </p>
                );
              case "List":
                return <p className="text-sm">{record.value}</p>;
              case "Person":
                return (
                  <p className="text-sm">
                    {employees.find((e) => e.id === record.userValue)?.name}
                  </p>
                );
              case "File":
                if (record.value) {
                  return (
                    <div className="flex gap-2 text-xs">
                      <LuPaperclip className="size-4 text-muted-foreground" />
                      <a
                        href={getPrivateUrl(record.value)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View File
                      </a>
                    </div>
                  );
                }
                return null;
              case "Inspection":
                return (
                  <div className="flex gap-2 items-center text-sm">
                    {record.value && (
                      <>
                        <LuPaperclip className="size-4 text-muted-foreground" />
                        <a
                          href={getPrivateUrl(record.value)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs"
                        >
                          View File
                        </a>
                      </>
                    )}
                    <Checkbox checked={record.booleanValue ?? false} />
                  </div>
                );
              default:
                return null;
            }
          },
          meta: {
            icon: <LuFileText />
          }
        },
        {
          id: "type",
          header: t`Type`,
          cell: ({ row }) => (
            <div className="flex items-center gap-2">
              <ProcedureStepTypeIcon type={row.original.type} />
              {row.original.type}
            </div>
          ),
          meta: {
            icon: <LuList />,
            filter: {
              type: "static",
              options: procedureStepType.map((type) => ({
                value: type,
                label: (
                  <div className="flex items-center gap-2">
                    <ProcedureStepTypeIcon type={type} />
                    {type}
                  </div>
                )
              }))
            }
          }
        },
        {
          accessorKey: "createdBy",
          header: t`Created By`,
          cell: ({ row }) => (
            <EmployeeAvatar
              employeeId={row.original.createdBy}
              withName={true}
            />
          ),
          meta: {
            icon: <LuUser />
          }
        },
        {
          accessorKey: "createdAt",
          header: t`Created At`,
          cell: ({ row }) => formatDateTime(row.original.createdAt ?? ""),
          meta: {
            icon: <LuCalendar />
          }
        }
      ];
    }, [numberFormatter, unitOfMeasures, employees, t]);

    return (
      <Table<JobOperationStepRecord>
        compact
        count={count}
        columns={columns}
        data={data}
        title={t`Step Records`}
      />
    );
  }
);

JobOperationStepRecordsTable.displayName = "JobOperationStepRecordsTable";

export default JobOperationStepRecordsTable;
