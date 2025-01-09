import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Button,
  HStack,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table as TableBase,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack,
} from "@carbon/react";
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
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { usePermissions, useRouteData, useUser } from "~/hooks";
import { methodType } from "~/modules/shared";
import { path } from "~/utils/path";
import type { Job, JobMaterial } from "../../types";

type JobMaterialsTableProps = {
  data: JobMaterial[];
  count: number;
};

const JobMaterialsTable = memo(({ data, count }: JobMaterialsTableProps) => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Job ID is required");
  const routeData = useRouteData<{
    job: Job;
  }>(path.to.job(jobId));

  const fetcher = useFetcher<{}>();
  const unitsOfMeasure = useUnitOfMeasure();
  const locations = useLocations();

  const columns = useMemo<ColumnDef<JobMaterial>[]>(() => {
    return [
      {
        accessorKey: "readableId",
        header: "Item ID",
        cell: ({ row }) => (
          <HStack className="py-1">
            <ItemThumbnail
              size="sm"
              // @ts-ignore
              type={row.original.itemType}
            />

            <VStack spacing={0}>
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
              <div className="w-full truncate text-muted-foreground text-xs">
                {row.original.description}
              </div>
            </VStack>
          </HStack>
        ),
        meta: {
          icon: <LuBookMarked />,
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
        accessorKey: "quantity",
        header: "Qty. per Parent",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />,
        },
      },
      {
        accessorKey: "estimatedQuantity",
        header: "Estimated Qty.",
        cell: (item) => item.getValue(),
        meta: {
          icon: <LuHash />,
        },
      },
      {
        id: "quantityOnHand",
        header: "Qty. On Hand",
        meta: {
          icon: <LuHash />,
        },
        cell: ({ row }) => {
          const isInventoried =
            row.original.item?.itemTrackingType === "Inventory";
          if (!isInventoried)
            return (
              <Badge variant="secondary">
                <TrackingTypeIcon type="Non-Inventory" className="mr-2" />
                <span>Non-Inventory</span>
              </Badge>
            );

          const quantityOnHand =
            row.original.item?.itemInventory?.reduce<number>((acc, curr) => {
              if (curr.locationId === routeData?.job.locationId)
                return acc + curr.quantityOnHand;
              return acc;
            }, 0) ?? 0;

          if (quantityOnHand < (row.original.estimatedQuantity ?? 0))
            return (
              <Popover>
                <PopoverTrigger>
                  <Badge variant="destructive">
                    <LuFlag className="mr-2" />
                    <span className="group-hover:hidden">Insufficient</span>
                    <span className="hidden group-hover:block">
                      {quantityOnHand}
                    </span>
                  </Badge>
                </PopoverTrigger>
                <PopoverContent className="w-[360px]">
                  <TableBase>
                    <Thead>
                      <Tr>
                        <Th>Location</Th>
                        <Th>Shelf</Th>
                        <Th>Qty.</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {row.original.item?.itemInventory?.map((i) => (
                        <Tr key={`${i.locationId}-${i.shelfId}`}>
                          <Td>
                            {
                              locations.find((l) => l.value === i.locationId)
                                ?.label
                            }
                          </Td>
                          <Td>{i.shelfId}</Td>
                          <Td>{i.quantityOnHand}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableBase>
                </PopoverContent>
              </Popover>
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
    ];
  }, [jobId, locations, routeData?.job.locationId, unitsOfMeasure]);

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
