import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Count,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useState } from "react";
import {
  LuArrowRight,
  LuCirclePlus,
  LuEllipsisVertical,
  LuPencilLine,
  LuQrCode,
  LuTrash,
  LuUndo2
} from "react-icons/lu";
import {
  Link,
  useFetchers,
  useNavigate,
  useParams,
  useSubmit
} from "react-router";
import { Empty, ItemThumbnail } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useRouteData } from "~/hooks";
import type { StockTransfer, StockTransferLine } from "~/modules/inventory";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

interface StockTransferLineProps {
  line: StockTransferLine;
  index: number;
  totalLines: number;
  pickedQuantity: number;
  isPickable: boolean;
  isEditable: boolean;
  isPending: boolean;
  onPick: (line: StockTransferLine) => void;
  onUnpick: (line: StockTransferLine) => void;
  onDelete: (line: StockTransferLine) => void;
  permissions: ReturnType<typeof usePermissions>;
}

function StockTransferLineComponent({
  line,
  index,
  totalLines,
  pickedQuantity,
  isPickable,
  isEditable,
  isPending,
  onPick,
  onUnpick,
  onDelete,
  permissions
}: StockTransferLineProps) {
  const navigate = useNavigate();
  const params = useParams();
  const { id } = params;
  if (!id) throw new Error("stock transfer id not found");
  const [items] = useItems();
  const unitsOfMeasure = useUnitOfMeasure();

  const item = items.find((p) => p.id === line.itemId);
  const isTracked = line.requiresSerialTracking || line.requiresBatchTracking;
  const isPicked = pickedQuantity > 0;

  return (
    <div
      className={cn(
        "flex flex-col border-b p-6 gap-6",
        index === totalLines - 1 && "border-none",
        isPicked && "opacity-50 hover:opacity-100"
      )}
    >
      <div className="flex justify-between items-center w-full">
        <HStack spacing={4} className="w-1/2 justify-between">
          <HStack spacing={4}>
            <ItemThumbnail
              size="md"
              thumbnailPath={line.thumbnailPath}
              type={(item?.type as "Part") ?? "Part"}
            />
            <VStack spacing={0} className="max-w-[380px] w-full">
              <div className="w-full overflow-hidden">
                <span className="text-sm font-medium truncate block w-full">
                  {item?.name}
                </span>
                <span className="text-xs text-muted-foreground truncate block w-full">
                  {item?.readableIdWithRevision}
                </span>
                {line.trackedEntityId && (
                  <span className="flex gap-1 text-xs text-muted-foreground truncate items-center w-full">
                    <LuQrCode /> {line.trackedEntityId}
                  </span>
                )}
              </div>
              <div className="mt-2">
                <Enumerable
                  value={
                    unitsOfMeasure?.find((u) => u.value === line.unitOfMeasure)
                      ?.label ?? null
                  }
                />
              </div>
            </VStack>
          </HStack>
          <Count
            count={line.quantity ?? 0}
            className={cn(
              "text-right text-white text-base",
              isPicked ? "bg-emerald-600" : "bg-red-600"
            )}
          />
        </HStack>
        <div className="flex flex-grow items-center justify-between gap-4 pl-4 w-1/2">
          <HStack spacing={4} className="text-left items-center">
            {"fromShelfId" in line && (
              <span className="text-base font-medium  whitespace-nowrap">
                {line.fromShelfName ?? ""}
              </span>
            )}
            <LuArrowRight className="size-4" />
            {"toShelfId" in line && (
              <span className="text-base font-medium  whitespace-nowrap">
                {line.toShelfName ?? ""}
              </span>
            )}
          </HStack>
          <HStack spacing={1}>
            {pickedQuantity === line.quantity ? (
              <Button
                variant="secondary"
                isDisabled={!isPickable || isPending}
                isLoading={isPending}
                leftIcon={<LuUndo2 />}
                onClick={() => onUnpick(line)}
              >
                Unpick
              </Button>
            ) : (
              <Button
                isDisabled={!isPickable || isPending}
                isLoading={isPending}
                leftIcon={isTracked ? <LuQrCode /> : <LuCirclePlus />}
                onClick={
                  isTracked
                    ? () => navigate(path.to.stockTransferScan(id, line.id!))
                    : () => onPick(line)
                }
              >
                Pick
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="secondary"
                  isDisabled={!isEditable}
                  icon={<LuEllipsisVertical />}
                  aria-label="Line options"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  disabled={
                    !isEditable || !permissions.can("update", "inventory")
                  }
                  asChild
                >
                  <Link
                    to={path.to.stockTransferLine(
                      line.stockTransferId!,
                      line.id!
                    )}
                  >
                    <DropdownMenuIcon icon={<LuPencilLine />} />
                    Edit Line
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={
                    !isEditable || !permissions.can("delete", "inventory")
                  }
                  destructive
                  onClick={() => onDelete(line)}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  Delete Line
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        </div>
      </div>
    </div>
  );
}

export default function StockTransferLines() {
  const params = useParams();
  const { id } = params;
  if (!id) throw new Error("stock transfer id not found");

  const permissions = usePermissions();
  const locations = useLocations();

  const routeData = useRouteData<{
    stockTransfer: StockTransfer;
    stockTransferLines: StockTransferLine[];
  }>(path.to.stockTransfer(id));

  const isPickable = ["Released", "In Progress"].includes(
    routeData?.stockTransfer?.status ?? ""
  );

  const isEditable = ["Draft", "Released", "In Progress"].includes(
    routeData?.stockTransfer?.status ?? ""
  );

  const [selectedLine, setSelectedLine] = useState<StockTransferLine | null>(
    null
  );
  const deleteDisclosure = useDisclosure();

  const lines = (routeData?.stockTransferLines ?? []).sort((a, b) => {
    // First sort by itemReadableId
    const itemComparison = (a.itemReadableId ?? "").localeCompare(
      b.itemReadableId ?? ""
    );
    if (itemComparison !== 0) return itemComparison;

    // Then sort by toShelfName
    const toShelfComparison = (a.toShelfName ?? "").localeCompare(
      b.toShelfName ?? ""
    );
    if (toShelfComparison !== 0) return toShelfComparison;

    // Finally sort by fromShelfName
    return (a.fromShelfName ?? "").localeCompare(b.fromShelfName ?? "");
  });

  const pickedQuantitiesById = new Map<string, number>();

  lines.forEach((line) => {
    if (!line.id) return;
    pickedQuantitiesById.set(line.id, line.pickedQuantity ?? 0);
  });

  const pendingQuantities = usePendingItems({ id });

  pendingQuantities.forEach((pendingQuantity) => {
    if (pendingQuantity.id) {
      pickedQuantitiesById.set(pendingQuantity.id, pendingQuantity.quantity);
    }
  });

  const submit = useSubmit();

  const onPick = (line: StockTransferLine) => {
    const formData = new FormData();
    formData.append("id", line.id!);
    formData.append("quantity", line.quantity!.toString());
    formData.append("locationId", routeData?.stockTransfer?.locationId ?? "");

    if (line.trackedEntityId) {
      formData.append("trackedEntityId", line.trackedEntityId);
    }

    submit(formData, {
      method: "post",
      action: path.to.stockTransferLineQuantity(id),
      navigate: false,
      fetcherKey: `stockTransferLine:${line.id}`
    });
  };

  const onUnpick = (line: StockTransferLine) => {
    const formData = new FormData();
    formData.append("id", line.id!);
    formData.append("quantity", "0");
    formData.append("locationId", routeData?.stockTransfer?.locationId ?? "");
    if (line.trackedEntityId) {
      formData.append("trackedEntityId", line.trackedEntityId);
    }

    submit(formData, {
      method: "post",
      action: path.to.stockTransferLineQuantity(id),
      navigate: false,
      fetcherKey: `stockTransferLine:${line.id}`
    });
  };

  return (
    <>
      <Card>
        <HStack className="justify-between items-center">
          <CardHeader>
            <CardTitle>Stock Transfer Lines</CardTitle>
            <CardDescription>
              <Enumerable
                value={
                  locations?.find(
                    (l) => l.value === routeData?.stockTransfer?.locationId
                  )?.label ?? null
                }
              />
            </CardDescription>
          </CardHeader>
          <CardAction>
            {isEditable && permissions.can("create", "inventory") && (
              <Button
                variant="secondary"
                isDisabled={!isEditable}
                leftIcon={<LuCirclePlus />}
                asChild
              >
                <Link to={path.to.newStockTransferLine(id)}>Add Line</Link>
              </Button>
            )}
          </CardAction>
        </HStack>

        <CardContent>
          <div className="border rounded-lg">
            {lines.length === 0 ? (
              <Empty className="py-6" />
            ) : (
              lines.map((line, index) => (
                <StockTransferLineComponent
                  key={line.id}
                  line={line}
                  index={index}
                  totalLines={lines.length}
                  pickedQuantity={pickedQuantitiesById.get(line.id ?? "") ?? 0}
                  isPickable={isPickable}
                  isEditable={isEditable}
                  isPending={
                    pendingQuantities?.some((q) => q.id === line.id) ?? false
                  }
                  onPick={onPick}
                  onUnpick={onUnpick}
                  onDelete={() => {
                    setSelectedLine(line);
                    deleteDisclosure.onOpen();
                  }}
                  permissions={permissions}
                />
              ))
            )}
          </div>
        </CardContent>
      </Card>
      {deleteDisclosure.isOpen && (
        <ConfirmDelete
          name="Stock Transfer Line"
          text="Are you sure you want to delete this stock transfer line?"
          action={path.to.deleteStockTransferLine(id, selectedLine?.id!)}
          onCancel={deleteDisclosure.onClose}
          onSubmit={deleteDisclosure.onClose}
        />
      )}
    </>
  );
}

const usePendingItems = ({ id }: { id: string }) => {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };

  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.stockTransferLineQuantity(id);
    })
    .reduce<{ id: string; quantity: number }[]>((acc, fetcher) => {
      const formData = fetcher.formData;
      const quantity = parseInt(formData.get("quantity") as string, 10);
      const lineId = fetcher.formData.get("id") as string;

      if (lineId && Number.isFinite(quantity)) {
        return [...acc, { id: lineId, quantity }];
      }
      return acc;
    }, []);
};
