// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCarbon } from "@carbon/auth";
import { useRevalidator } from "@carbon/query";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  Table as TableBase,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  useDisclosure
} from "@carbon/react";
import {
  distinctItemText,
  formatDate,
  RoundingMode,
  round
} from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { LuCircleCheck, LuCirclePlus, LuExternalLink } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { SupplierAvatar } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useQuantityFormatter } from "~/hooks";
import type { SupplierPart } from "~/modules/items/types";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { getLinkToItemPlanning } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import { SupplierPartPrice } from "~/modules/items/ui/Item/SupplierParts";
import type { PlanningAction } from "~/modules/production";
import {
  type PlanningActionHandlers,
  reviewPathFor
} from "~/modules/production/ui/Planning/PlanningActionLines";
import {
  BeyondFenceButton,
  PlanningPolicySummary,
  periodIdFor
} from "~/modules/production/ui/Planning/PlanningDrawerParts";
import type {
  OpenOrderField,
  OpenOrderRow
} from "~/modules/production/ui/Planning/PlanningOrderGrids";
import {
  actionForOrder,
  DeferredDrawerSections,
  OpenOrdersGrid,
  SuggestedOrdersGrid
} from "~/modules/production/ui/Planning/PlanningOrderGrids";
import { chartedOrderQuantity } from "~/modules/production/ui/Planning/planning-increase";
import type { action as bulkUpdateAction } from "~/routes/x+/purchasing+/planning.update";
import { path } from "~/utils/path";
import type {
  PlannedOrder,
  purchaseOrderStatusType
} from "../../purchasing.models";
import {
  isPurchaseOrderEditableFromPlanning,
  isPurchaseOrderLocked
} from "../../purchasing.models";
import type { PurchasingPlanningItem } from "../../types";
import { PurchasingStatus } from "../PurchaseOrder";

/** An existing PO line in the planned-order shape the chart reads, plus the
 *  factor between its purchase units and inventory units, and the quantity it
 *  was read at (so the chart can tell a planner's edit from the stored line). */
type OpenPurchaseOrder = PlannedOrder & {
  existingLineId: string;
  conversionFactor: number;
  /** Purchase units already received, on a line whose quantity is the ordered
   *  total (an editable one); 0 on a sent line, which shows what is to come. */
  receivedOffset: number;
  loadedQuantity: number;
};

type PurchasingPlanningOrderDrawerProps = {
  /**
   * Today on the plant's calendar (the planning loader's `locationToday`).
   * Planned-order defaults are business dates there, and "late" is measured
   * from it, never from the planner's browser zone.
   */
  locationToday: string;
  isOpen: boolean;
  locationId: string;
  orders: PlannedOrder[];
  /** Suggested orders required AFTER the row's time fence. The drawer opens
   *  without them; one button extends the fence to take them in. */
  beyondFenceOrders: PlannedOrder[];
  /** The row's time fence (ISO date), or null when it has none. */
  timeFenceDate: string | null;
  /** True when the fence was moved on screen, away from the saved horizon. */
  isTimeFenceOverridden: boolean;
  /** Move this row's fence without leaving the drawer — the same on-screen
   *  override as the grid's Planning Horizon cell. `null` clears the fence
   *  for this view. The suggested orders re-split around the new date. */
  onTimeFenceChange: (date: string | null) => void;
  /** The item's change actions on existing orders, inside the fence. Each one
   *  is shown on the row of the order it targets. */
  actions: PlanningAction[];
  /** Apply / dismiss / reopen / assign, owned by the grid (one fetcher). */
  actionHandlers: PlanningActionHandlers;
  /** Bumped when a purchase order was reopened or finalized from the page:
   *  the open orders are re-read, since no action of theirs changed. */
  ordersVersion?: number;
  periods: { id: string; startDate: string; endDate: string }[];
  selectedItem: PurchasingPlanningItem;
  selectedSupplier: string;
  onClose: () => void;
  onSupplierChange: (itemId: string, supplierId: string) => void;
  setOrders: (item: PurchasingPlanningItem, orders: PlannedOrder[]) => void;
  setSelectedItem: (item: PurchasingPlanningItem) => void;
};

export const PurchasingPlanningOrderDrawer = memo(
  ({
    selectedItem,
    setSelectedItem,
    orders,
    beyondFenceOrders,
    timeFenceDate,
    isTimeFenceOverridden,
    onTimeFenceChange,
    actions,
    actionHandlers,
    ordersVersion = 0,
    setOrders,
    locationId,
    periods,
    selectedSupplier,
    isOpen,
    onClose,
    onSupplierChange,
    locationToday
  }: PurchasingPlanningOrderDrawerProps) => {
    const { t } = useLingui();
    const { locale } = useLocale();
    const fenceLabel = timeFenceDate
      ? formatDate(timeFenceDate, undefined, locale)
      : null;
    const fetcher = useFetcher<typeof bulkUpdateAction>();
    const { revalidate } = useRevalidator();
    const { carbon } = useCarbon();

    const formatQuantity = useQuantityFormatter();
    const unitOfMeasureOptions = useUnitOfMeasure();

    const [activeTab, setActiveTab] = useState("ordering");

    // ── Open orders: the item's existing PO lines ───────────────────────────
    // Held here, not in the grid's draft list: a cell edit on one of these is
    // SAVED (onSaveOpenOrder), where a suggested order is a draft until Order
    // is pressed. `null` while loading, an Error when the read failed.
    const [openOrders, setOpenOrders] = useState<
      OpenPurchaseOrder[] | null | Error
    >(null);

    // Re-read when the item's actions change: applying one rewrites its line.
    const actionsKey = actions.map((a) => `${a.id}:${a.status}`).join(",");

    // Only while open: the drawer stays mounted on its last item so it can
    // slide out, and that item's actions change with every Apply on the grid.
    // biome-ignore lint/correctness/useExhaustiveDependencies: actionsKey stands in for `actions`; periods are fixed for the page
    useEffect(() => {
      if (!isOpen || !carbon || !selectedItem.id) return;
      let isCurrent = true;

      (async () => {
        const lines = await carbon
          .from("openPurchaseOrderLines")
          .select("*")
          .eq("itemId", selectedItem.id)
          // this page's location only: the rows are editable and charted here
          .eq("locationId", locationId)
          .in("status", [
            "To Review",
            "Needs Approval",
            "Planned",
            "To Receive",
            "To Receive and Invoice",
            "To Invoice"
          ]);
        if (!isCurrent) return;
        if (lines.error) {
          setOpenOrders(new Error(lines.error.message));
          return;
        }

        // The view reports the quantity in INVENTORY units; the cell edits the
        // line's own purchase quantity, so read that and its factor too.
        const lineIds = (lines.data ?? []).flatMap((line) =>
          line.id ? [line.id] : []
        );
        const details =
          lineIds.length > 0
            ? await carbon
                .from("purchaseOrderLine")
                .select(
                  "id, purchaseQuantity, quantityToReceive, quantityReceived, conversionFactor"
                )
                .in("id", lineIds)
            : { data: [], error: null };
        if (!isCurrent) return;
        if (details.error) {
          setOpenOrders(new Error(details.error.message));
          return;
        }
        const detailById = new Map(
          (details.data ?? []).map((detail) => [detail.id, detail])
        );

        setOpenOrders(
          (lines.data ?? [])
            .flatMap((line): OpenPurchaseOrder[] => {
              if (!line.id) return [];
              const detail = detailById.get(line.id);
              const isLocked = isPurchaseOrderLocked(line.status);
              // purchase units: what is still to come on a sent line, the
              // ordered quantity on one that can still be changed
              const quantity = Number(
                (isLocked
                  ? detail?.quantityToReceive
                  : detail?.purchaseQuantity) ?? 0
              );
              return [
                {
                  existingId: line.purchaseOrderId ?? undefined,
                  existingLineId: line.id,
                  existingReadableId: line.purchaseOrderReadableId ?? undefined,
                  // inventory units, as the chart's supply rows are
                  existingQuantity:
                    line.status === "Draft" ? 0 : (line.quantityToReceive ?? 0),
                  existingStatus: line.status ?? undefined,
                  startDate: line.orderDate ?? null,
                  dueDate: line.dueDate ?? null,
                  quantity,
                  loadedQuantity: quantity,
                  receivedOffset: isLocked
                    ? 0
                    : Number(detail?.quantityReceived ?? 0),
                  periodId: periodIdFor(periods, line.dueDate),
                  supplierId: line.supplierId ?? undefined,
                  conversionFactor: Number(detail?.conversionFactor ?? 1) || 1
                }
              ];
            })
            .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
        );
      })();

      return () => {
        isCurrent = false;
      };
    }, [
      isOpen,
      carbon,
      selectedItem.id,
      locationId,
      actionsKey,
      ordersVersion
    ]);

    const openOrderRows = useMemo<OpenOrderRow[] | null | Error>(() => {
      if (!Array.isArray(openOrders)) return openOrders;

      const rows: OpenOrderRow[] = openOrders.map((order) => {
        const action = actionForOrder(
          actions,
          (a) => a.purchaseOrderLineId === order.existingLineId
        );
        return {
          id: order.existingLineId,
          documentPath: order.existingId
            ? path.to.purchaseOrderLine(order.existingId, order.existingLineId)
            : null,
          readableId: order.existingReadableId ?? "",
          status: order.existingStatus ?? null,
          quantity: order.quantity,
          dueDate: order.dueDate ?? null,
          // the server's gate: Draft / Planned only, not in approval or sent
          isEditable: isPurchaseOrderEditableFromPlanning(order.existingStatus),
          action,
          // the action's quantity is in inventory units and is what the line
          // must still bring; the row is in purchase units, rounded up to
          // whole units, plus what was received when the row shows the
          // ordered total — the quantity Apply writes
          suggestedQuantity: action
            ? order.receivedOffset +
              round(
                Number(action.suggestedQuantity) / order.conversionFactor,
                0,
                RoundingMode.Up
              )
            : null,
          purchaseOrder: order.existingId
            ? {
                id: order.existingId,
                readableId: order.existingReadableId,
                status: order.existingStatus ?? null,
                // the view's orderDate is the PO's, read in as the start date
                orderDate: order.startDate ?? null
              }
            : null
        };
      });

      // An action whose order is not in the list still has to be shown — a
      // suggestion that silently drops out of the drawer reads as "nothing to
      // do". It gets a read-only row built from the action itself.
      for (const action of actions) {
        if (rows.some((row) => row.action?.id === action.id)) continue;
        rows.push({
          id: action.id,
          documentPath: reviewPathFor(action),
          readableId: action.purchaseOrderReadableId ?? "—",
          status: action.purchaseOrderStatus ?? null,
          quantity: null,
          dueDate: null,
          isEditable: false,
          action,
          suggestedQuantity: Number(action.suggestedQuantity)
        });
      }

      return rows;
    }, [openOrders, actions]);

    const onOpenOrdersChange = useCallback((rows: OpenOrderRow[]) => {
      setOpenOrders((previous) =>
        Array.isArray(previous)
          ? previous.map((order) => {
              const row = rows.find((r) => r.id === order.existingLineId);
              return row && row.quantity !== null
                ? { ...order, quantity: row.quantity, dueDate: row.dueDate }
                : order;
            })
          : previous
      );
    }, []);

    // One cell, one field, one request. The route re-reads the line under the
    // company and refuses a PO that has been sent, so a stale row here cannot
    // edit a committed order.
    const onSaveOpenOrder = useCallback(
      async (
        row: OpenOrderRow,
        field: OpenOrderField,
        value: number | string
      ) => {
        try {
          const response = await fetch(path.to.bulkUpdatePurchasingPlanning, {
            method: "post",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "updateLine",
              locationId,
              line: { id: row.id, field, value }
            })
          });
          const result = (await response.json().catch(() => null)) as {
            success?: boolean;
            message?: string;
          } | null;
          if (response.ok && result?.success) {
            // A plain fetch bypasses the router: refresh the grid row behind
            // the drawer, which otherwise shows the old value until the next
            // navigation.
            void revalidate();
            return true;
          }
          toast.error(
            result?.message ?? t`Failed to update purchase order line`
          );
          return false;
        } catch {
          toast.error(t`Failed to update purchase order line`);
          return false;
        }
      },
      [locationId, revalidate, t]
    );

    const renderOpenOrderStatus = useCallback(
      (status: string) => (
        <PurchasingStatus
          iconOnly
          status={status as (typeof purchaseOrderStatusType)[number]}
        />
      ),
      []
    );

    // What the chart overlays as planned supply: the draft orders, plus the
    // open orders so an edit to one shows before MRP runs again — at its open
    // Increase, which took the place of a draft order. The chart reads
    // existing orders in inventory units (see mergePlannedOrders), and only
    // what is still to come: received units are already on hand.
    const chartOrders = useMemo<PlannedOrder[]>(
      () => [
        ...orders,
        ...(Array.isArray(openOrders)
          ? openOrders.map(
              ({
                conversionFactor,
                loadedQuantity,
                receivedOffset,
                ...order
              }) => ({
                ...order,
                quantity: chartedOrderQuantity({
                  quantity:
                    Math.max(order.quantity - receivedOffset, 0) *
                    conversionFactor,
                  loadedQuantity:
                    Math.max(loadedQuantity - receivedOffset, 0) *
                    conversionFactor,
                  increase: actionForOrder(
                    actions,
                    (a) =>
                      a.type === "Increase" &&
                      a.purchaseOrderLineId === order.existingLineId
                  )
                })
              })
            )
          : [])
      ],
      [orders, openOrders, actions]
    );

    // "N More After <fence>": move this row's fence out to the last suggested
    // order, rather than copying those orders into the list. The fence is the
    // one piece of state — the order list, the Action table below, and the
    // grid row's chips and quantity all follow it, so the pulled-in orders and
    // their Order actions appear together and stay in step.
    const lastBeyondFenceDate = useMemo(
      () =>
        beyondFenceOrders.reduce<string | null>(
          (latest, order) =>
            order.dueDate && (!latest || order.dueDate > latest)
              ? order.dueDate
              : latest,
          null
        ),
      [beyondFenceOrders]
    );

    const onIncludeBeyondFence = useCallback(() => {
      if (lastBeyondFenceDate) onTimeFenceChange(lastBeyondFenceDate);
    }, [lastBeyondFenceDate, onTimeFenceChange]);

    const onSuggestedOrdersChange = useCallback(
      (next: PlannedOrder[]) => setOrders(selectedItem, next),
      [selectedItem, setOrders]
    );

    const onAddOrder = useCallback(() => {
      if (selectedItem.id) {
        // Get the conversion factor from the selected supplier
        const supplier = (selectedItem.suppliers as SupplierPart[])?.find(
          (s) => s.supplierId === selectedSupplier
        );
        const conversionFactor = supplier?.conversionFactor ?? 1;

        // Convert inventory quantity to purchase quantity
        const inventoryQuantity =
          selectedItem.lotSize ?? selectedItem.minimumOrderQuantity ?? 0;
        const purchaseQuantity =
          conversionFactor > 0
            ? Math.ceil(inventoryQuantity / conversionFactor)
            : inventoryQuantity;

        const newOrder: PlannedOrder = {
          quantity: purchaseQuantity,
          dueDate: parseDate(locationToday)
            .add({ days: selectedItem.leadTime ?? 0 })
            .toString(),
          startDate: locationToday,
          supplierId: selectedSupplier ?? selectedItem.preferredSupplierId,
          itemReadableId: selectedItem.readableIdWithRevision,
          description: selectedItem.name,
          periodId: periods[0].id
        };
        setOrders(selectedItem, [...orders, newOrder]);
      }
    }, [
      selectedItem,
      orders,
      setOrders,
      periods,
      selectedSupplier,
      locationToday
    ]);

    const onSubmit = useCallback(
      (id: string, orders: PlannedOrder[]) => {
        const ordersWithPeriods = orders.map((order) => {
          // Stamp the currently-selected supplier onto every order. Orders built
          // by onAddOrder/plannedOrdersFromActions may carry a null
          // supplierId (e.g. the item has no preferredSupplierId), which the
          // server validator rejects as "No suppliers provided" — the Order
          // button already guards that selectedSupplier is set.
          const supplierId = selectedSupplier ?? order.supplierId;
          return {
            ...order,
            supplierId,
            periodId: periodIdFor(periods, order.dueDate)
          };
        });

        const payload = {
          locationId,
          items: [
            {
              id: id,
              orders: ordersWithPeriods
            }
          ],
          action: "order" as const
        };
        fetcher.submit(payload, {
          method: "post",
          action: path.to.bulkUpdatePurchasingPlanning,
          encType: "application/json"
        });
      },
      [fetcher, locationId, periods, selectedSupplier]
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    useEffect(() => {
      if (fetcher.state !== "idle" || !fetcher.data) {
        return;
      }

      if (fetcher.data?.success === false && fetcher?.data?.message) {
        toast.error(fetcher.data.message);
      }

      if (fetcher.data?.success === true) {
        const purchaseOrders =
          (
            fetcher.data as {
              purchaseOrders?: { id: string; readableId: string }[];
            }
          )?.purchaseOrders ?? [];

        if (purchaseOrders.length === 0) {
          toast.success(t`Orders submitted`);
        } else {
          toast.success(
            <div className="flex gap-1">
              <span>{t`Orders submitted`}</span>
              <span className="flex flex-wrap gap-2 text-xs">
                {purchaseOrders.map((po) => (
                  <Link
                    key={po.id}
                    to={path.to.purchaseOrder(po.id)}
                    className="underline underline-offset-2 hover:opacity-80"
                  >
                    {po.readableId}
                  </Link>
                ))}
              </span>
            </div>,
            { duration: 8000 }
          );
        }

        setOrders(selectedItem, []);
        onClose();
      }
    }, [fetcher.state, fetcher.data]);

    const supplierDisclosure = useDisclosure();

    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <DrawerContent size="lg">
            <DrawerHeader className="relative">
              <DrawerTitle className="flex items-center gap-2">
                <span>{selectedItem.readableIdWithRevision}</span>
                <Link
                  to={getLinkToItemPlanning(
                    selectedItem.type as "Part",
                    selectedItem.id
                  )}
                >
                  <LuExternalLink />
                </Link>
              </DrawerTitle>
              {distinctItemText(
                selectedItem.readableIdWithRevision,
                selectedItem.name
              ) && <DrawerDescription>{selectedItem.name}</DrawerDescription>}
              <div className="absolute top-4 right-12">
                <TabsList>
                  <TabsTrigger value="ordering">
                    <Trans>Ordering</Trans>
                  </TabsTrigger>
                  <TabsTrigger value="suppliers">
                    <Trans>Suppliers</Trans>
                  </TabsTrigger>
                </TabsList>
              </div>
            </DrawerHeader>
            <DrawerBody>
              <div className="flex flex-col gap-4  w-full">
                <TabsContent value="suppliers" className="flex flex-col gap-4">
                  <TableBase>
                    <Thead>
                      <Tr>
                        <Th>
                          <Trans>Supplier</Trans>
                        </Th>
                        <Th>
                          <Trans>Unit</Trans>
                        </Th>
                        <Th>
                          <Trans>Conversion</Trans>
                        </Th>
                        <Th>
                          <Trans>Unit Price</Trans>
                        </Th>
                        <Th />
                      </Tr>
                    </Thead>
                    <Tbody>
                      {(selectedItem.suppliers as SupplierPart[])?.map(
                        (part) => (
                          <Tr key={part.id}>
                            <Td>
                              <SupplierAvatar supplierId={part.supplierId} />
                            </Td>
                            <Td>
                              {
                                unitOfMeasureOptions.find(
                                  (uom) =>
                                    uom.value === part.supplierUnitOfMeasureCode
                                )?.label
                              }
                            </Td>
                            <Td>{part.conversionFactor}</Td>
                            <Td>
                              <SupplierPartPrice
                                price={part.supplierUnitPrice}
                                currencyCode={part.currencyCode}
                              />
                            </Td>
                            <Td className="text-end">
                              <Button
                                variant="secondary"
                                isDisabled={
                                  selectedSupplier === part.supplierId
                                }
                                leftIcon={<LuCircleCheck />}
                                onClick={() => {
                                  if (selectedItem.id) {
                                    onSupplierChange(
                                      selectedItem.id,
                                      part.supplierId
                                    );

                                    const updatedOrders = orders.map(
                                      (order) => ({
                                        ...order,
                                        supplierId: part.supplierId
                                      })
                                    );
                                    setOrders(selectedItem, updatedOrders);

                                    toast.success(t`Supplier updated`);
                                    setActiveTab("ordering");
                                  }
                                }}
                              >
                                <Trans>Select</Trans>
                              </Button>
                            </Td>
                          </Tr>
                        )
                      )}
                    </Tbody>
                  </TableBase>
                  <div>
                    <Button
                      variant="secondary"
                      leftIcon={<LuCirclePlus />}
                      onClick={supplierDisclosure.onOpen}
                    >
                      <Trans>Add Supplier</Trans>
                    </Button>
                    {supplierDisclosure.isOpen && (
                      <SupplierPartForm
                        type="Part"
                        initialValues={{
                          itemId: selectedItem.id,
                          supplierId: "",
                          supplierPartId: "",
                          supplierUnitPrice: 0,
                          supplierUnitOfMeasureCode: "EA",
                          minimumOrderQuantity: 1,
                          orderMultiple: 1,
                          conversionFactor: 1
                        }}
                        unitOfMeasureCode={selectedItem.unitOfMeasureCode ?? ""}
                        onClose={() => {
                          if (carbon && selectedItem.id) {
                            carbon
                              ?.from("supplierPart")
                              .select("*")
                              .eq("itemId", selectedItem.id)
                              .then(({ data }) => {
                                if (data) {
                                  setSelectedItem(
                                    // @ts-expect-error
                                    (prev: PurchasingPlanningItem) => {
                                      return {
                                        ...prev,
                                        suppliers: data as SupplierPart[]
                                      };
                                    }
                                  );

                                  // Auto-select the newly added supplier if it's the only one
                                  if (data.length === 1 && selectedItem.id) {
                                    onSupplierChange(
                                      selectedItem.id,
                                      data[0].supplierId
                                    );

                                    const updatedOrders = orders.map(
                                      (order) => ({
                                        ...order,
                                        supplierId: data[0].supplierId
                                      })
                                    );
                                    setOrders(selectedItem, updatedOrders);

                                    toast.success(
                                      t`Supplier added and selected`
                                    );
                                    setActiveTab("ordering");
                                  }
                                }
                              });
                          }
                          supplierDisclosure.onClose();
                        }}
                      />
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="ordering" className="flex flex-col gap-4">
                  <PlanningPolicySummary
                    item={selectedItem}
                    fenceDate={timeFenceDate}
                    isFenceOverridden={isTimeFenceOverridden}
                    onFenceChange={onTimeFenceChange}
                  >
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        <Trans>Supplier:</Trans>
                      </span>
                      <SupplierAvatar supplierId={selectedSupplier} />
                    </HStack>
                    <HStack className="justify-between w-full">
                      <span className="text-muted-foreground">
                        <Trans>Purchase Unit:</Trans>
                      </span>
                      <span>
                        {unitOfMeasureOptions.find(
                          (uom) =>
                            uom.value ===
                            (selectedItem.suppliers as SupplierPart[])?.find(
                              (s) => s.supplierId === selectedSupplier
                            )?.supplierUnitOfMeasureCode
                        )?.label ??
                          selectedItem.unitOfMeasureCode ??
                          "EA"}
                      </span>
                    </HStack>
                    {(() => {
                      const supplier = (
                        selectedItem.suppliers as SupplierPart[]
                      )?.find((s) => s.supplierId === selectedSupplier);
                      const factor = supplier?.conversionFactor ?? 1;
                      const conversionFactor = formatQuantity(factor);
                      return factor !== 1 ? (
                        <HStack className="justify-between w-full">
                          <span className="text-muted-foreground">
                            <Trans>Conversion:</Trans>
                          </span>
                          <span>
                            <Trans>
                              1 Purchase = {conversionFactor} Inventory
                            </Trans>
                          </span>
                        </HStack>
                      ) : null;
                    })()}
                  </PlanningPolicySummary>

                  <DeferredDrawerSections>
                    <SuggestedOrdersGrid<PlannedOrder>
                      title={<Trans>Suggested Orders</Trans>}
                      titleAction={
                        lastBeyondFenceDate &&
                        timeFenceDate && (
                          <BeyondFenceButton
                            count={beyondFenceOrders.length}
                            fenceLabel={fenceLabel}
                            onClick={onIncludeBeyondFence}
                          />
                        )
                      }
                      orders={orders}
                      leadTime={selectedItem.leadTime ?? 0}
                      todayIso={locationToday}
                      quantityHeader={t`Purchase Qty`}
                      orderByHeader={t`Order By`}
                      onChange={onSuggestedOrdersChange}
                      onAdd={onAddOrder}
                    />

                    <OpenOrdersGrid
                      title={<Trans>Open Orders</Trans>}
                      documentHeader={t`PO`}
                      quantityHeader={t`Qty`}
                      rows={openOrderRows}
                      todayIso={locationToday}
                      renderStatusIcon={renderOpenOrderStatus}
                      onSave={onSaveOpenOrder}
                      onRowsChange={onOpenOrdersChange}
                      {...actionHandlers}
                    />

                    <ItemPlanningChart
                      compact
                      itemId={selectedItem.id}
                      locationId={locationId}
                      safetyStock={selectedItem.demandAccumulationSafetyStock}
                      timeFenceDate={timeFenceDate}
                      plannedOrders={chartOrders}
                      conversionFactor={
                        (selectedItem.suppliers as SupplierPart[])?.find(
                          (s) => s.supplierId === selectedSupplier
                        )?.conversionFactor ?? 1
                      }
                    />
                  </DeferredDrawerSections>
                </TabsContent>
              </div>
            </DrawerBody>
            <DrawerFooter>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Close</Trans>
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (!selectedSupplier) {
                    toast.error(
                      t`Cannot place order - no supplier associated with this item`
                    );
                    return;
                  }
                  onSubmit(selectedItem.id, orders);
                }}
                disabled={fetcher.state !== "idle" || orders.length === 0}
                isDisabled={fetcher.state !== "idle" || orders.length === 0}
                isLoading={fetcher.state !== "idle"}
              >
                <Trans>Order</Trans>
              </Button>
            </DrawerFooter>
          </DrawerContent>
        </Tabs>
      </Drawer>
    );
  }
);

PurchasingPlanningOrderDrawer.displayName = "PurchasingPlanningOrderDrawer";
