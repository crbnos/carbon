import { Badge, HStack } from "@carbon/react";
import { useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useMemo } from "react";
import { Hyperlink, MethodIcon, MethodItemTypeIcon, Table } from "~/components";
import { methodItemType, methodType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { JobMaterial } from "../../types";

type JobMaterialsTableProps = {
  data: JobMaterial[];
  count: number;
};

const JobMaterialsTable = memo(({ data, count }: JobMaterialsTableProps) => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Job ID is required");

  const columns = useMemo<ColumnDef<JobMaterial>[]>(() => {
    return [
      {
        accessorKey: "readableId",
        header: "Item ID",
        cell: ({ row }) => (
          <HStack className="py-1">
            <Hyperlink
              to={path.to.jobMethodMaterial(
                jobId,
                row.original.methodType,
                row.original.jobMakeMethodId,
                row.original.id
              )}
              className="max-w-[260px] truncate"
            >
              {row.original.itemReadableId}
            </Hyperlink>
          </HStack>
        ),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => row.original.description,
      },
      {
        accessorKey: "methodType",
        header: "Method Type",
        cell: (item) => (
          <Badge variant="secondary">
            <MethodIcon type={item.getValue<string>()} className="mr-2" />
            <span>{item.getValue<string>()}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: methodType.map((value) => ({
              value,
              label: (
                <Badge variant="secondary">
                  <MethodIcon type={value} className="mr-2" />
                  <span>{value}</span>
                </Badge>
              ),
            })),
          },
        },
      },
      {
        accessorKey: "itemType",
        header: "Type",
        cell: ({ row }) => (
          <Badge variant="secondary">
            <MethodItemTypeIcon type={row.original.itemType} className="mr-2" />
            <span>{row.original.itemType}</span>
          </Badge>
        ),
        meta: {
          filter: {
            type: "static",
            options: methodItemType.map((type) => ({
              label: (
                <HStack spacing={2}>
                  <MethodItemTypeIcon type={type} />
                  <span>{type}</span>
                </HStack>
              ),
              value: type,
            })),
          },
        },
      },

      {
        accessorKey: "unitOfMeasureCode",
        header: "UoM",
        cell: (item) => item.getValue(),
      },

      {
        accessorKey: "quantity",
        header: "Qty. per Parent",
        cell: (item) => item.getValue(),
      },
      {
        accessorKey: "estimatedQuantity",
        header: "Estimated Qty",
        cell: (item) => item.getValue(),
      },
    ];
  }, [jobId]);

  return <Table<JobMaterial> count={count} columns={columns} data={data} />;
});

JobMaterialsTable.displayName = "JobMaterialsTable";

export default JobMaterialsTable;
