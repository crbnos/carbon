// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  MENU_ITEM_SHORTCUTS,
  NonNettableBadge,
  NumberField,
  NumberInput,
  toast,
  useDisclosure,
  VStack
} from "@carbon/react";
import { round } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { Link, useFetchers, useNavigate, useParams } from "react-router";
import { Empty, ItemThumbnail, PrintButton } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions, useQuantityFormatter, useRouteData } from "~/hooks";
import { useNonNettableStorageUnits } from "~/hooks/useNonNettableStorageUnits";
import { isStockTransferLocked } from "~/modules/inventory/inventory.models";
import type {
  StockTransfer,
  StockTransferLine
} from "~/modules/inventory/types";
import type { action as quantityAction } from "~/routes/x+/stock-transfer+/$id.line.quantity";
import { useItems } from "~/stores";
import { path } from "~/utils/path";

interface StockTransferLineProps {
  line: StockTransferLine;
  index: number;
  totalLines: number;
  locationId?: string;
  pickedQuantity: number;
  isPickable: boolean;
  /** A picked line can be taken back on a Completed transfer too. */
  canUnpick: boolean;
  isEditable: boolean;
  isPending: boolean;
  onDelete: (line: StockTransferLine) => void;
  permissions: ReturnType<typeof usePermissions>;
}

function StockTransferLineComponent({
  line,
  index,
  totalLines,
  locationId,
  pickedQuantity,
  isPickable,
  canUnpick,
  isEditable,
  isPending,
  onDelete,
  permissions
}: StockTransferLineProps) {
  const { t } = useLingui();
  const nonNettable = useNonNettableStorageUnits();
  // A line without the key names no unit on that side; one with the key
  // and no name has no storage unit.
  const fromLabel =
    "fromStorageUnitId" in line
      ? (line.fromStorageUnitName ?? t`No storage unit`)
      : null;
  const toLabel =
    "toStorageUnitId" in line
      ? (line.toStorageUnitName ?? t`No storage unit`)
      : null;
  const fromNonNettable =
    !!line.fromStorageUnitId && nonNettable.has(line.fromStorageUnitId);
  const toNonNettable =
    !!line.toStorageUnitId && nonNettable.has(line.toStorageUnitId);
  const navigate = useNavigate();
  const params = useParams();
  const { id } = params;
  if (!id) throw new Error("stock transfer id not found");

  // One fetcher per line, so lines pick side by side; the pending state is
  // read back through `usePendingItems`.
  const pick = useAction<typeof quantityAction>({
    key: `stockTransferLine:${line.id}`,
    onSuccess: ({ data }) => {
      // The next pick starts from what is left, not the last typed quantity.
      setEnteredQuantity(null);
      if (!data) return;
      toast.success(
        data.quantity === 0
          ? t`Line unpicked`
          : data.quantity === 1
            ? t`1 item marked as picked`
            : t`${data.quantity} items marked as picked`
      );
    }
  });
  // Pick moves the line's quantity; 0 unpicks it.
  const submitPick = (quantity: number) => {
    const formData = new FormData();
    formData.append("id", line.id!);
    formData.append("quantity", quantity.toString());
    formData.append("locationId", locationId ?? "");
    if (line.trackedEntityId) {
      formData.append("trackedEntityId", line.trackedEntityId);
    }
    pick.submit(formData, {
      method: "post",
      action: path.to.stockTransferLineQuantity(id)
    });
  };
  const [items] = useItems();
  const unitsOfMeasure = useUnitOfMeasure();
  const formatQuantity = useQuantityFormatter();

  const item = items.find((p) => p.id === line.itemId);
  const itemName = item?.readableIdWithRevision ?? line.itemId ?? "";
  const isTracked = line.requiresSerialTracking || line.requiresBatchTracking;
  const quantity = line.quantity ?? 0;
  // Pick moves what is left, so a partly picked line is never over-picked.
  const outstanding = Math.max(0, round(quantity - pickedQuantity));
  // At the same precision as `outstanding`, so the two never disagree.
  const isPicked = quantity > 0 && pickedQuantity > 0 && outstanding === 0;
  // The From bin is where the stock was when the transfer was made. When it
  // no longer holds what is left to pick, the line says where the stock is now.
  const liveBins = line.liveStorageUnits;
  const fromHolds =
    liveBins?.find((bin) => bin.id === (line.fromStorageUnitId ?? null))
      ?.quantity ?? 0;
  // What the picker typed; until then the Pick takes all that is left.
  const [enteredQuantity, setEnteredQuantity] = useState<number | null>(null);
  const pickQuantity = Math.min(
    outstanding,
    Math.max(0, round(enteredQuantity ?? outstanding))
  );
  const stockElsewhere =
    liveBins && outstanding > 0 && fromHolds < outstanding ? liveBins : null;

  return (
    <div
      className={cn(
        "@container flex flex-col border-b p-6 gap-6 max-md:p-4 max-md:gap-4",
        index === totalLines - 1 && "border-none",
        isPicked && "opacity-50 hover:opacity-100"
      )}
    >
      {/* Sized by the line's own width, not the viewport: the content pane
          it sits in is resizable. The item takes what the move and actions
          leave, and they share one line once the row is wide enough. */}
      <div className="flex flex-col @3xl:flex-row @3xl:items-center gap-4 w-full">
        <HStack
          spacing={4}
          className="w-full @3xl:w-auto @3xl:flex-1 min-w-0 justify-between"
        >
          <HStack spacing={4} className="flex-1 min-w-0">
            <ItemThumbnail
              size="md"
              thumbnailPath={line.thumbnailPath}
              type={(item?.type as "Part") ?? "Part"}
            />
            <VStack spacing={0} className="flex-1 min-w-0">
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
          <VStack spacing={1} className="w-auto shrink-0 items-end">
            <span className="text-base font-medium tabular-nums">
              {formatQuantity(quantity)}
            </span>
            <Badge variant={isPicked ? "green" : "secondary"}>
              {isPicked ? (
                <Trans>Picked</Trans>
              ) : (
                <Trans>
                  {formatQuantity(pickedQuantity)} / {formatQuantity(quantity)}{" "}
                  picked
                </Trans>
              )}
            </Badge>
          </VStack>
        </HStack>
        <div className="flex items-center justify-between gap-4 w-full @3xl:w-auto @3xl:flex-1 min-w-0 max-md:gap-3">
          <div className="grid min-w-0 grid-cols-[minmax(0,auto)_auto_minmax(0,auto)] items-center gap-x-3 gap-y-1 text-left">
            <span
              className="truncate text-base font-medium"
              title={fromLabel ?? undefined}
            >
              {fromLabel}
            </span>
            <LuArrowRight className="size-4 shrink-0" />
            <span
              className="truncate text-base font-medium"
              title={toLabel ?? undefined}
            >
              {toLabel}
            </span>
            {stockElsewhere && (
              <span className="col-span-3 text-sm text-muted-foreground">
                {stockElsewhere.length > 0 ? (
                  <>
                    <Trans>Stock at:</Trans>{" "}
                    {stockElsewhere
                      .map(
                        (bin) =>
                          `${bin.name ?? t`No storage unit`} (${formatQuantity(bin.quantity)})`
                      )
                      .join(", ")}
                  </>
                ) : (
                  <Trans>Location not known</Trans>
                )}
              </span>
            )}
            {(fromNonNettable || toNonNettable) && (
              <>
                <span>{fromNonNettable && <NonNettableBadge />}</span>
                <span />
                <span>{toNonNettable && <NonNettableBadge />}</span>
              </>
            )}
          </div>
          <HStack spacing={1} className="shrink-0">
            {line.trackedEntityId && (
              <PrintButton
                sourceDocument="Entity"
                sourceDocumentId={line.trackedEntityId}
                locationId={locationId}
                context="inventory"
                fileRoutes={{
                  pdf: path.to.file.trackedEntityLabelPdf,
                  zpl: path.to.file.trackedEntityLabelZpl
                }}
              />
            )}
            {pickedQuantity > 0 && (
              <Button
                variant="secondary"
                isDisabled={!canUnpick || isPending}
                isLoading={isPending && isPicked}
                leftIcon={<LuUndo2 />}
                onClick={() => submitPick(0)}
              >
                <Trans>Unpick</Trans>
              </Button>
            )}
            {!isPicked && !isTracked && isPickable && outstanding > 0 && (
              <NumberField
                aria-label={t`Quantity to pick of ${item?.name ?? ""}`}
                value={pickQuantity}
                minValue={0}
                maxValue={outstanding}
                onChange={(value) =>
                  setEnteredQuantity(Number.isNaN(value) ? null : value)
                }
              >
                <NumberInput
                  size="sm"
                  className="w-24"
                  isDisabled={isPending}
                />
              </NumberField>
            )}
            {!isPicked && (
              <Button
                isDisabled={
                  !isPickable ||
                  isPending ||
                  outstanding <= 0 ||
                  (!isTracked && pickQuantity <= 0)
                }
                isLoading={isPending}
                leftIcon={isTracked ? <LuQrCode /> : <LuCirclePlus />}
                onClick={
                  isTracked
                    ? () => navigate(path.to.stockTransferScan(id, line.id!))
                    : () => submitPick(pickQuantity)
                }
              >
                <Trans>Pick</Trans>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  variant="secondary"
                  isDisabled={!isEditable}
                  icon={<LuEllipsisVertical />}
                  aria-label={t`Line options for ${itemName}`}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  shortcut={MENU_ITEM_SHORTCUTS.edit}
                  disabled={
                    !isEditable ||
                    !permissions.has({ "inventory.stockTransfers": "Edit" })
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
                    <Trans>Edit Line</Trans>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  shortcut={MENU_ITEM_SHORTCUTS.delete}
                  disabled={
                    !isEditable ||
                    !permissions.has({ "inventory.stockTransfers": "Full" })
                  }
                  destructive
                  onClick={() => onDelete(line)}
                >
                  <DropdownMenuIcon icon={<LuTrash />} />
                  <Trans>Delete Line</Trans>
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

  const isLocked = isStockTransferLocked(routeData?.stockTransfer?.status);

  const isEditable =
    !isLocked &&
    ["Draft", "Released", "In Progress"].includes(
      routeData?.stockTransfer?.status ?? ""
    );

  const [selectedLine, setSelectedLine] = useState<StockTransferLine | null>(
    null
  );
  const deleteDisclosure = useDisclosure();

  const lines = (routeData?.stockTransferLines ?? []).sort((a, b) => {
    // First sort by itemReadableId
    // Numbers as numbers ("P-2" before "P-10"), as the picking list does.
    const itemComparison = (a.itemReadableId ?? "").localeCompare(
      b.itemReadableId ?? "",
      undefined,
      { numeric: true }
    );
    if (itemComparison !== 0) return itemComparison;

    // Then sort by toStorageUnitName
    const toStorageUnitComparison = (a.toStorageUnitName ?? "").localeCompare(
      b.toStorageUnitName ?? ""
    );
    if (toStorageUnitComparison !== 0) return toStorageUnitComparison;

    // Finally sort by fromStorageUnitName
    return (a.fromStorageUnitName ?? "").localeCompare(
      b.fromStorageUnitName ?? ""
    );
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

  return (
    <>
      <Card>
        <HStack className="justify-between items-center">
          <CardHeader>
            <CardTitle>
              <Trans>Stock Transfer Lines</Trans>
            </CardTitle>
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
            {isEditable &&
              permissions.has({ "inventory.stockTransfers": "Create" }) && (
                <Button
                  variant="secondary"
                  isDisabled={!isEditable}
                  leftIcon={<LuCirclePlus />}
                  asChild
                >
                  <Link to={path.to.newStockTransferLine(id)}>
                    <Trans>Add Line</Trans>
                  </Link>
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
                  locationId={routeData?.stockTransfer?.locationId ?? undefined}
                  pickedQuantity={pickedQuantitiesById.get(line.id ?? "") ?? 0}
                  isPickable={isPickable}
                  canUnpick={
                    isPickable ||
                    routeData?.stockTransfer?.status === "Completed"
                  }
                  isEditable={isEditable}
                  isPending={
                    pendingQuantities?.some((q) => q.id === line.id) ?? false
                  }
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
      {selectedLine && (
        <ConfirmDelete
          isOpen={deleteDisclosure.isOpen}
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
