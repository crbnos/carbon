import type { Result } from "@carbon/auth";
import {
  Badge,
  Button,
  Count,
  HStack,
  IconButton,
  MenuIcon,
  MenuItem,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useMount,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useNumberFormatter } from "@react-aria/i18n";
import type { ColumnDef } from "@tanstack/react-table";
import { memo, useEffect, useMemo, useState } from "react";
import {
  LuArrowDown,
  LuArrowLeftRight,
  LuArrowUp,
  LuBookMarked,
  LuCalendarX,
  LuCheckCheck,
  LuFlag,
  LuHash,
  LuMaximize2,
  LuMinus,
  LuRefreshCcwDot,
  LuShoppingCart,
  LuTrash2,
  LuTruck,
  LuX
} from "react-icons/lu";
import { useFetcher, useParams } from "react-router";
import {
  Hyperlink,
  ItemThumbnail,
  MethodIcon,
  Table,
  TrackingTypeIcon
} from "~/components";
import { usePermissions, useRouteData, useUrlParams } from "~/hooks";
import { useItems } from "~/stores";
import {
  addToStockTransferSession,
  removeFromStockTransferSession,
  useOrderItems,
  useStockTransferSession,
  useStockTransferSessionItemsCount,
  useTransferItems
} from "~/stores/stock-transfer";
import { path } from "~/utils/path";
import type { Job, JobMaterial } from "../../types";

type JobMaterialsTableProps = {
  data: JobMaterial[];
  count: number;
  nearExpiryWarningDays?: number | null;
};
const JobMaterialsTable = memo(
  ({ data, count, nearExpiryWarningDays }: JobMaterialsTableProps) => {
    const { jobId } = useParams();
    const { t } = useLingui();
    if (!jobId) throw new Error("Job ID is required");

    const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));
    const isRequired = ["Planned", "Ready", "In Progress", "Paused"].includes(
      routeData?.job?.status ?? ""
    );

    const fetcher = useFetcher<{}>();
    const formatter = useNumberFormatter();

    const [items] = useItems();
    const [, setSearchParams] = useUrlParams();

    const sessionItemsCount = useStockTransferSessionItemsCount();
    const [session, setStockTransferSession] = useStockTransferSession();

    useMount(() => {
      // Pre-populate stock transfer session with all parts that need transferred or ordered
      const itemsToAdd: Array<{
        id: string; // Job material ID
        itemId: string; // Actual item ID
        itemReadableId: string;
        description: string;
        action: "transfer" | "order";
        quantity: number;
        requiresSerialTracking: boolean;
        requiresBatchTracking: boolean;
        storageUnitId?: string;
      }> = [];

      data.forEach((material) => {
        if (
          material.itemTrackingType === "Non-Inventory" ||
          material.methodType === "Make to Order" ||
          !material.id
        ) {
          return;
        }

        const quantityRequiredByStorageUnit = isRequired
          ? material.quantityFromProductionOrderInStorageUnit
          : material.quantityFromProductionOrderInStorageUnit +
            material.estimatedQuantity;

        // Check if transfer is needed
        const quantityOnHandInStorageUnit =
          material.quantityOnHandInStorageUnit;
        const quantityInTransitToStorageUnit =
          material.quantityInTransitToStorageUnit;
        const hasStorageUnitQuantityFlag =
          quantityOnHandInStorageUnit + quantityInTransitToStorageUnit <
          quantityRequiredByStorageUnit;

        if (hasStorageUnitQuantityFlag) {
          itemsToAdd.push({
            id: material.id, // Job material ID
            itemId: material.jobMaterialItemId, // Actual item ID
            itemReadableId: material.itemReadableId,
            description: material.description,
            action: "transfer",
            quantity:
              quantityRequiredByStorageUnit - quantityOnHandInStorageUnit,
            requiresSerialTracking: material.itemTrackingType === "Serial",
            requiresBatchTracking: material.itemTrackingType === "Batch",
            storageUnitId: material.storageUnitId
          });
        }

        // Check if order is needed
        const quantityOnHand =
          material.quantityOnHandInStorageUnit +
          material.quantityOnHandNotInStorageUnit;

        const incoming =
          material.quantityOnPurchaseOrder + material.quantityOnProductionOrder;

        const required =
          material.quantityFromProductionOrderInStorageUnit +
          material.quantityFromProductionOrderNotInStorageUnit +
          material.quantityOnSalesOrder;

        const hasTotalQuantityFlag = quantityOnHand + incoming - required < 0;

        if (hasTotalQuantityFlag) {
          itemsToAdd.push({
            id: material.id, // Job material ID
            itemId: material.jobMaterialItemId, // Actual item ID
            itemReadableId: material.itemReadableId,
            description: material.description,
            action: "order",
            quantity:
              (material.estimatedQuantity ?? 0) -
              (quantityOnHand + incoming - required),
            requiresSerialTracking: material.itemTrackingType === "Serial",
            requiresBatchTracking: material.itemTrackingType === "Batch",
            storageUnitId: material.storageUnitId
          });
        }
      });

      if (itemsToAdd.length > 0) {
        setStockTransferSession({ items: itemsToAdd });
      }
    });

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    const columns = useMemo<ColumnDef<JobMaterial>[]>(() => {
      return [
        {
          accessorKey: "readableIdWithRevision",
          header: t`Item`,
          cell: ({ row }) => (
            <HStack className="py-1">
              <ItemThumbnail
                size="md"
                // @ts-ignore
                type={row.original.itemType}
              />

              <VStack spacing={0}>
                <HStack spacing={2}>
                  <Hyperlink
                    to={path.to.jobMakeMethod(
                      jobId,
                      row.original.jobMakeMethodId
                    )}
                    onClick={() => {
                      setSearchParams({ materialId: row.original.id ?? null });
                    }}
                    className="max-w-[260px] truncate"
                  >
                    {row.original.itemReadableId}
                  </Hyperlink>
                  {nearExpiryWarningDays !== null &&
                    nearExpiryWarningDays !== undefined &&
                    row.original.hasExpiredBatch && (
                      <Badge variant="red" className="gap-1 text-xs shrink-0">
                        <LuCalendarX className="size-3" />
                        <Trans>Expired batch</Trans>
                      </Badge>
                    )}
                </HStack>
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
                label: item.readableIdWithRevision
              }))
            }
          }
        },
        {
          accessorKey: "estimatedQuantity",
          header: t`Required`,
          cell: ({ row }) => formatter.format(row.original.estimatedQuantity),
          meta: {
            icon: <LuHash />
          }
        },
        {
          id: "method",
          header: t`Method`,
          cell: ({ row }) => (
            <HStack>
              <Badge variant="secondary">
                <MethodIcon
                  type={row.original.methodType}
                  className="size-3 mr-1"
                />
                {row.original.storageUnitName ??
                  (row.original.methodType === "Make to Order"
                    ? t`WIP`
                    : t`Default Storage Unit`)}
              </Badge>
            </HStack>
          )
        },

        {
          id: "quantityOnHandInStorageUnit",
          header: t`On Storage Unit`,
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

            const quantityRequiredByStorageUnit = isRequired
              ? row.original.quantityFromProductionOrderInStorageUnit
              : row.original.quantityFromProductionOrderInStorageUnit +
                row.original.estimatedQuantity;

            if (row.original.methodType === "Make to Order") {
              return null;
            }

            const quantityOnHandInStorageUnit =
              row.original.quantityOnHandInStorageUnit;
            const quantityInTransitToStorageUnit =
              row.original.quantityInTransitToStorageUnit;
            const hasStorageUnitQuantityFlag =
              quantityOnHandInStorageUnit + quantityInTransitToStorageUnit <
              quantityRequiredByStorageUnit;

            return (
              <HStack>
                {hasStorageUnitQuantityFlag ? (
                  <>
                    <span className="text-red-500">
                      {formatter.format(quantityOnHandInStorageUnit)}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <LuFlag className="text-red-500" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex flex-col gap-1 text-xs">
                          <div className="font-medium">
                            Storage unit demand exceeds supply
                          </div>
                          <div>
                            On hand at unit:{" "}
                            {formatter.format(quantityOnHandInStorageUnit)}
                          </div>
                          <div>
                            In transit to unit:{" "}
                            {formatter.format(quantityInTransitToStorageUnit)}
                          </div>
                          <div>
                            Required at unit:{" "}
                            {formatter.format(quantityRequiredByStorageUnit)}
                          </div>
                          <div className="font-medium">
                            Net:{" "}
                            {formatter.format(
                              quantityOnHandInStorageUnit +
                                quantityInTransitToStorageUnit -
                                quantityRequiredByStorageUnit
                            )}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <span>{formatter.format(quantityOnHandInStorageUnit)}</span>
                )}
              </HStack>
            );
          },
          meta: {
            icon: <LuHash />
          }
        },
        {
          id: "quantityOnHand",
          header: t`On Hand`,
          cell: ({ row }) => {
            if (
              row.original.itemTrackingType === "Non-Inventory" ||
              row.original.methodType === "Make to Order"
            ) {
              return null;
            }
            const quantityOnHand =
              row.original.quantityOnHandInStorageUnit +
              row.original.quantityOnHandNotInStorageUnit;

            const incoming =
              row.original.quantityOnPurchaseOrder +
              row.original.quantityOnProductionOrder;

            const required =
              row.original.quantityFromProductionOrderInStorageUnit +
              row.original.quantityFromProductionOrderNotInStorageUnit +
              row.original.quantityOnSalesOrder;

            const hasTotalQuantityFlag =
              quantityOnHand + incoming - required < 0;

            return (
              <HStack>
                {hasTotalQuantityFlag ? (
                  <>
                    <span className="text-red-500">
                      {formatter.format(quantityOnHand)}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <LuFlag className="text-red-500" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex flex-col gap-1 text-xs">
                          <div className="font-medium">
                            Future demand exceeds supply
                          </div>
                          <div>On hand: {formatter.format(quantityOnHand)}</div>
                          <div>Incoming: {formatter.format(incoming)}</div>
                          <div>Required: {formatter.format(required)}</div>
                          <div className="font-medium">
                            Net:{" "}
                            {formatter.format(
                              quantityOnHand + incoming - required
                            )}
                          </div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <span>{formatter.format(quantityOnHand)}</span>
                )}
              </HStack>
            );
          },
          meta: {
            icon: <LuHash />
          }
        },
        {
          id: "required",
          header: t`Required`,
          cell: ({ row }) =>
            formatter.format(
              row.original.quantityFromProductionOrderInStorageUnit +
                row.original.quantityFromProductionOrderNotInStorageUnit +
                row.original.quantityOnSalesOrder
            ),
          meta: {
            icon: <LuArrowDown className="text-red-600" />
          }
        },
        {
          id: "incoming",
          header: t`Incoming`,
          cell: ({ row }) =>
            formatter.format(
              row.original.quantityOnPurchaseOrder +
                row.original.quantityOnProductionOrder
            ),
          meta: {
            icon: <LuArrowUp className="text-emerald-600" />
          }
        },
        {
          id: "transfer",
          header: t`Transfer`,
          cell: ({ row }) =>
            formatter.format(row.original.quantityInTransitToStorageUnit),
          meta: {
            icon: <LuArrowLeftRight className="text-blue-600" />
          }
        }
      ];
    }, [
      items,
      jobId,
      setSearchParams,
      isRequired,
      formatter,
      sessionItemsCount
    ]);

    const renderContextMenu = useMemo(() => {
      return (row: JobMaterial) => {
        // Skip non-inventory items and make items
        if (
          row.itemTrackingType === "Non-Inventory" ||
          row.methodType === "Make to Order" ||
          !row.id
        ) {
          return null;
        }

        const quantityRequiredByStorageUnit = isRequired
          ? row.quantityFromProductionOrderInStorageUnit
          : row.quantityFromProductionOrderInStorageUnit +
            row.estimatedQuantity;

        const quantityOnHandInStorageUnit = row.quantityOnHandInStorageUnit;

        const quantityOnHand =
          row.quantityOnHandInStorageUnit + row.quantityOnHandNotInStorageUnit;
        const incoming =
          row.quantityOnPurchaseOrder + row.quantityOnProductionOrder;
        const required =
          row.quantityFromProductionOrderInStorageUnit +
          row.quantityFromProductionOrderNotInStorageUnit +
          row.quantityOnSalesOrder;

        // Check if items are already in session
        const isInSessionForTransfer = session.items.some(
          (item) => item.id === row.id && item.action === "transfer"
        );
        const isInSessionForOrder = session.items.some(
          (item) => item.id === row.id && item.action === "order"
        );

        return (
          <>
            <MenuItem
              destructive={isInSessionForTransfer}
              onClick={() => {
                if (isInSessionForTransfer) {
                  removeFromStockTransferSession(row.id!, "transfer");
                } else {
                  addToStockTransferSession({
                    id: row.id!, // Job material ID
                    itemId: row.jobMaterialItemId, // Actual item ID
                    itemReadableId: row.itemReadableId,
                    description: row.description,
                    action: "transfer",
                    quantity:
                      quantityRequiredByStorageUnit -
                      quantityOnHandInStorageUnit,
                    requiresSerialTracking: row.itemTrackingType === "Serial",
                    requiresBatchTracking: row.itemTrackingType === "Batch",
                    storageUnitId: row.storageUnitId
                  });
                }
              }}
            >
              <MenuIcon icon={<LuTruck />} />
              {isInSessionForTransfer ? t`Remove Transfer` : t`Transfer`}
            </MenuItem>
            <MenuItem
              destructive={isInSessionForOrder}
              onClick={() => {
                if (isInSessionForOrder) {
                  removeFromStockTransferSession(row.id!, "order");
                } else {
                  addToStockTransferSession({
                    id: row.id!, // Job material ID
                    itemId: row.jobMaterialItemId, // Actual item ID
                    itemReadableId: row.itemReadableId,
                    description: row.description,
                    action: "order",
                    quantity:
                      (row.estimatedQuantity ?? 0) -
                      (quantityOnHand + incoming - required),
                    requiresSerialTracking: row.itemTrackingType === "Serial",
                    requiresBatchTracking: row.itemTrackingType === "Batch",
                    storageUnitId: row.storageUnitId
                  });
                }
              }}
            >
              <MenuIcon icon={<LuShoppingCart />} />
              {isInSessionForOrder ? t`Remove Order` : t`Order`}
            </MenuItem>
          </>
        );
      };
    }, [isRequired, session.items, t]);

    const permissions = usePermissions();

    return (
      <>
        <Table<JobMaterial>
          compact
          count={count}
          columns={columns}
          data={data}
          primaryAction={
            data.length > 0 && permissions.can("update", "production") ? (
              <fetcher.Form
                action={path.to.jobRecalculate(jobId)}
                method="post"
              >
                <Button
                  leftIcon={<LuRefreshCcwDot />}
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                  type="submit"
                  variant="secondary"
                >
                  <Trans>Recalculate</Trans>
                </Button>
              </fetcher.Form>
            ) : undefined
          }
          renderContextMenu={renderContextMenu}
          title={t`Materials`}
        />
        <StockTransferSessionWidget jobId={jobId} />
      </>
    );
  }
);

JobMaterialsTable.displayName = "JobMaterialsTable";

export default JobMaterialsTable;

const StockTransferSessionWidget = ({ jobId }: { jobId: string }) => {
  const fetcher = useFetcher<Result>();
  const { t } = useLingui();

  const [session, setStockTransferSession] = useStockTransferSession();
  const sessionItemsCount = useStockTransferSessionItemsCount();
  const orderItems = useOrderItems();
  const transferItems = useTransferItems();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const allItems = [...orderItems, ...transferItems];

  const onRemoveItem = (itemId: string, action: "order" | "transfer") => {
    const updatedItems = session.items.filter(
      (sessionItem) =>
        !(sessionItem.id === itemId && sessionItem.action === action)
    );
    setStockTransferSession({ items: updatedItems });
  };

  const onClearAll = () => {
    setStockTransferSession({ items: [] });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (fetcher.data?.success) {
      onClearAll();
    }
  }, [fetcher.data?.success]);

  if (sessionItemsCount === 0) {
    return null;
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setIsMinimized(false)}
          className="relative flex items-center justify-center w-16 h-16 bg-card border-2 border-border rounded-full shadow-2xl hover:scale-105 transition-transform duration-200"
        >
          <LuShoppingCart className="w-6 h-6 text-foreground" />
          {allItems.length > 0 && (
            <Badge className="absolute -top-2 -right-2 h-7 w-7 flex items-center justify-center p-0 border-2 border-background">
              {allItems.length}
            </Badge>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-[9999]">
      <div
        className={`bg-card border-2 border-border rounded-2xl shadow-2xl transition-all duration-300 ease-in-out ${
          isExpanded ? "w-96 h-[32rem]" : "w-80 h-auto"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-2 border-border">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 bg-primary rounded-lg">
              <LuCheckCheck className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-card-foreground text-base">
                <Trans>Action Items</Trans>
              </h3>
              <p className="text-xs text-muted-foreground">
                {allItems.length} {allItems.length === 1 ? t`item` : t`items`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={isExpanded ? t`Minimize` : t`Expand`}
              icon={
                isExpanded ? (
                  <LuMinus className="size-4" />
                ) : (
                  <LuMaximize2 className="size-4" />
                )
              }
              onClick={() => setIsExpanded(!isExpanded)}
            />
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t`Close`}
              icon={<LuX className="size-4" />}
              onClick={() => setIsMinimized(true)}
            />
          </div>
        </div>

        {/* Content */}
        {isExpanded ? (
          <div className="flex flex-col h-[calc(32rem-5rem)]">
            <ScrollArea className="flex-1 p-4">
              {allItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                    <LuShoppingCart className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <Trans>No parts added yet</Trans>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    <Trans>Start adding parts to your stock transfer</Trans>
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orderItems.length > 0 && (
                    <div className="mb-4">
                      <HStack className="mb-2">
                        <LuShoppingCart className="h-3 w-3" />
                        <span className="text-sm font-medium">
                          <Trans>Orders</Trans>{" "}
                          <Count count={orderItems.length} />
                        </span>
                      </HStack>
                      <div className="space-y-2">
                        {orderItems.map((item) => (
                          <div
                            key={`${item.id}-order`}
                            className="group bg-secondary/50 border border-border rounded-lg p-3 hover:bg-secondary transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="font-mono text-xs font-semibold">
                                    {item.itemReadableId}
                                  </span>
                                  <Badge variant="outline">
                                    <Trans>Order</Trans>
                                  </Badge>
                                </div>
                                <p className="text-sm text-card-foreground font-medium truncate">
                                  {item.description}
                                </p>
                              </div>
                              <IconButton
                                variant="secondary"
                                aria-label={t`Remove item`}
                                icon={<LuTrash2 />}
                                size="sm"
                                onClick={() => onRemoveItem(item.id, "order")}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {transferItems.length > 0 && (
                    <div>
                      <HStack className="mb-2">
                        <LuTruck className="h-3 w-3" />
                        <span className="text-sm font-medium">
                          <Trans>Transfers</Trans>{" "}
                          <Count count={transferItems.length} />
                        </span>
                      </HStack>
                      <div className="space-y-2">
                        {transferItems.map((item) => (
                          <div
                            key={`${item.id}-transfer`}
                            className="group bg-secondary/50 border border-border rounded-lg p-3 hover:bg-secondary transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="font-mono text-xs font-semibold">
                                    {item.itemReadableId}
                                  </span>
                                  <Badge variant="outline">
                                    <Trans>Transfer</Trans>
                                  </Badge>
                                </div>
                                <p className="text-sm text-card-foreground font-medium truncate">
                                  {item.description}
                                </p>
                              </div>
                              <IconButton
                                variant="secondary"
                                aria-label={t`Remove item`}
                                icon={<LuTrash2 />}
                                size="sm"
                                onClick={() =>
                                  onRemoveItem(item.id, "transfer")
                                }
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>

            {/* Footer */}
            {allItems.length > 0 && (
              <div className="p-4 border-t-2 border-border space-y-2 w-full">
                <fetcher.Form
                  method="post"
                  action={path.to.newJobMaterialsSession(jobId)}
                >
                  <input type="hidden" name="jobId" value={jobId} />
                  <input
                    type="hidden"
                    name="items"
                    value={JSON.stringify(allItems)}
                  />
                  <Button
                    isLoading={fetcher.state !== "idle"}
                    isDisabled={fetcher.state !== "idle"}
                    size="lg"
                    className="w-full"
                    type="submit"
                  >
                    <Trans>Create</Trans>
                  </Button>
                </fetcher.Form>
                <Button variant="ghost" className="w-full" onClick={onClearAll}>
                  <Trans>Clear All</Trans>
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {allItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">
                <Trans>No parts added yet</Trans>
              </p>
            ) : (
              <div className="space-y-2">
                {allItems.slice(0, 3).map((item) => (
                  <div
                    key={`${item.id}-${item.action}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-mono text-xs">
                      {item.itemReadableId}
                    </span>
                    <Badge variant="outline">{item.action}</Badge>
                  </div>
                ))}
                {allItems.length > 3 && (
                  <p className="text-xs text-muted-foreground text-center pt-1">
                    <Trans>+{allItems.length - 3} more</Trans>
                  </p>
                )}
              </div>
            )}
            {allItems.length > 0 && (
              <fetcher.Form
                method="post"
                action={path.to.newJobMaterialsSession(jobId)}
              >
                <input type="hidden" name="jobId" value={jobId} />
                <input
                  type="hidden"
                  name="items"
                  value={JSON.stringify(allItems)}
                />
                <Button
                  isLoading={fetcher.state !== "idle"}
                  isDisabled={fetcher.state !== "idle"}
                  size="lg"
                  className="w-full"
                  type="submit"
                >
                  Create
                </Button>
              </fetcher.Form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
