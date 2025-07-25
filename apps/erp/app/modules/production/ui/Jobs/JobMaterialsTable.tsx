import { useCarbon } from "@carbon/auth";
import { Badge, Button, HStack, VStack } from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useCallback, useMemo } from "react";
import {
  LuBookMarked,
  LuCircleCheck,
  LuFlag,
  LuHash,
  LuRefreshCcwDot,
  LuRuler,
} from "react-icons/lu";
import { RxCodesandboxLogo } from "react-icons/rx";
import {
  Hyperlink,
  ItemThumbnail,
  MethodIcon,
  Table,
  TrackingTypeIcon,
} from "~/components";
import { EditableNumber, EditableText } from "~/components/Editable";
import { Enumerable } from "~/components/Enumerable";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions, useUser } from "~/hooks";
import { methodType } from "~/modules/shared";
import { useBom, useItems } from "~/stores";
import { path } from "~/utils/path";
import type { JobMaterial } from "../../types";

type JobMaterialsTableProps = {
  data: JobMaterial[];
  count: number;
};

const JobMaterialsTable = memo(({ data, count }: JobMaterialsTableProps) => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Job ID is required");

  const fetcher = useFetcher<{}>();
  const unitsOfMeasure = useUnitOfMeasure();

  const [items] = useItems();
  const [, setSelectedMaterialId] = useBom();

  const columns = useMemo<ColumnDef<JobMaterial>[]>(() => {
    return [
      {
        accessorKey: "itemReadableId",
        header: "Item",
        cell: ({ row }) => (
          <HStack className="py-1">
            <ItemThumbnail
              size="md"
              // @ts-ignore
              type={row.original.itemType}
            />

            <VStack spacing={0}>
              <Hyperlink
                to={path.to.jobMakeMethod(jobId, row.original.jobMakeMethodId)}
                onClick={() => {
                  setSelectedMaterialId(row.original.id ?? null);
                }}
                className="max-w-[260px] truncate"
              >
                {row.original.itemReadableId}
              </Hyperlink>
              <div className="w-full truncate text-muted-foreground text-xs">
                {row.original.description}
              </div>
            </VStack>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />,
          filter: {
            type: "static",
            options: items.map((item) => ({
              value: item.readableIdWithRevision,
              label: item.readableIdWithRevision,
            })),
          },
        },
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
          icon: <RxCodesandboxLogo />,
        },
      },

      {
        accessorKey: "unitOfMeasureCode",
        header: "UoM",
        cell: (item) => (
          <Enumerable
            value={
              unitsOfMeasure.find((u) => u.value === item.getValue())?.label ??
              null
            }
          />
        ),
        meta: {
          icon: <LuRuler />,
        },
      },

      {
        accessorKey: "quantityPerParent",
        header: "Qty. per Parent",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />,
        },
      },
      {
        accessorKey: "estimatedQuantity",
        header: "Estimated",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />,
        },
      },
      {
        id: "quantityOnHand",
        header: "On Hand",
        meta: {
          icon: <LuHash />,
        },
        cell: ({ row }) => {
          const isInventoried =
            row.original.itemTrackingType !== "Non-Inventory";
          if (!isInventoried)
            return (
              <Badge variant="secondary">
                <TrackingTypeIcon type="Non-Inventory" className="mr-2" />
                <span>Non-Inventory</span>
              </Badge>
            );

          if (row.original.methodType === "Make") {
            return null;
          }

          const quantityOnHand = row.original.quantityOnHand;

          if (quantityOnHand < (row.original.estimatedQuantity ?? 0))
            return (
              <Badge variant="destructive">
                <LuFlag className="mr-2" />
                <span className="group-hover:hidden">Insufficient</span>
                <span className="hidden group-hover:block">
                  {quantityOnHand}
                </span>
              </Badge>
            );

          return (
            <Badge variant="green">
              <LuCircleCheck className="mr-2" />
              <span className="group-hover:hidden">In Stock</span>
              <span className="hidden group-hover:block">{quantityOnHand}</span>
            </Badge>
          );
        },
      },
      {
        id: "quantityOnPurchaseOrder",
        header: "On PO",
        cell: ({ row }) => row.original.quantityOnPurchaseOrder,
        meta: {
          icon: <LuHash />,
        },
      },
      {
        id: "quantityOnProductionOrder",
        header: "In Prod.",
        cell: ({ row }) => row.original.quantityOnProductionOrder,
        meta: {
          icon: <LuHash />,
        },
      },
    ];
  }, [items, jobId, setSelectedMaterialId, unitsOfMeasure]);

  const permissions = usePermissions();
  const { carbon } = useCarbon();
  const { id: userId } = useUser();
  const onCellEdit = useCallback(
    async (id: string, value: unknown, row: JobMaterial) => {
      if (!carbon) throw new Error("Carbon client not found");
      return await carbon
        .from("jobMaterial")
        .update({
          [id]: value,
          updatedBy: userId,
        })
        .eq("id", row.id!);
    },
    [carbon, userId]
  );

  const editableComponents = useMemo(() => {
    return {
      description: EditableText(onCellEdit),
      quantity: EditableNumber(onCellEdit),
      estimatedQuantity: EditableNumber(onCellEdit),
    };
  }, [onCellEdit]);

  return (
    <Table<JobMaterial>
      compact
      count={count}
      columns={columns}
      data={data}
      primaryAction={
        data.length > 0 && permissions.can("update", "production") ? (
          <fetcher.Form action={path.to.jobRecalculate(jobId)} method="post">
            <Button
              leftIcon={<LuRefreshCcwDot />}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
              variant="secondary"
            >
              Recalculate
            </Button>
          </fetcher.Form>
        ) : undefined
      }
      editableComponents={editableComponents}
      title="Materials"
      withInlineEditing={permissions.can("update", "production")}
    />
  );
});

JobMaterialsTable.displayName = "JobMaterialsTable";

export default JobMaterialsTable;
