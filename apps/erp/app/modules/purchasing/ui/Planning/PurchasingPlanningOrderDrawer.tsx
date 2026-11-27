// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RefreshRate, useAction, useLoaderQuery } from "@carbon/query";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  toastError
} from "@carbon/react";
import { distinctItemText, formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { Dispatch, SetStateAction } from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import { SupplierAvatar } from "~/components";
import { useUnitOfMeasure } from "~/components/Form/UnitOfMeasure";
import { useQuantityFormatter } from "~/hooks";
import type { SupplierPart } from "~/modules/items/types";
import { getLinkToItemPlanning } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import type { RefusedPlanningOrder } from "~/modules/production/production.models";
import type { DrawerPlannedOrder } from "~/modules/production/production.utils";
import type { PlanningAction } from "~/modules/production/types";
import { DrawerPlannedOrders } from "~/modules/production/ui/Planning/DrawerPlannedOrders";
import {
  type OpenOrderField,
  type OpenOrderRow,
  OpenOrdersGrid
} from "~/modules/production/ui/Planning/OpenOrdersGrid";
import {
  purchaseUnitsFor,
  refusedOrdersOfRow,
  supplierConversionFactor
} from "~/modules/production/ui/Planning/planned-orders-from-actions";
import { actionForOrder } from "~/modules/production/ui/Planning/planning-review";
import {
  type PlanningActionHandlers,
  reviewPathFor
} from "~/modules/production/ui/Planning/PlanningActionLines";
import {
  BeyondFenceButton,
  PlanningPolicySummary,
  periodIdFor
} from "~/modules/production/ui/Planning/PlanningDrawerParts";
import { DeferredDrawerSections } from "~/modules/production/ui/Planning/PlanningOrderGridParts";
import { SuggestedOrdersGrid } from "~/modules/production/ui/Planning/SuggestedOrdersGrid";
import {
  useAnswerOverlay,
  useDrawerSuggestions,
  useSaveOrderCell,
  withEdits,
  withOrphanActionRows
} from "~/modules/production/ui/Planning/useDrawerOrders";
import { usePastStartToast } from "~/modules/production/ui/Planning/usePastStartToast";
import type { loader as openLinesLoader } from "~/routes/api+/purchasing.planning-open-lines";
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
import { DrawerSuppliersTab } from "./DrawerSuppliersTab";
import {
  type OpenPurchaseOrder,
  openOrdersForChart
} from "./open-orders-chart";

/** What `orderPlannedPurchases` returns, read from the route's merged answer. */
type OrderPlannedPurchasesOutcome = {
  purchaseOrders?: { id: string; readableId: string }[];
  refusedOrders?: RefusedPlanningOrder[];
  processedItems?: number;
  warnings?: string[];
  errors?: string[];
};

/**
 * The item's open PO lines at the location, read through
 * `api+/purchasing.planning-open-lines`. Every change that moves them here
 * (an Apply, an order placed, a PO reopened or finalized) posts through a
 * router fetcher, and the root invalidation middleware marks the read stale.
 * A line edited in the drawer posts with a plain fetch and refetches itself
 * (`useSaveOrderCell`).
 */
function useDrawerOpenPurchaseOrderLines(url: string | null) {
  return useLoaderQuery<typeof openLinesLoader>(url, {
    staleTime: RefreshRate.High,
    // the drawer remounts per item, so this only keeps the list on screen
    // while a closed drawer slides out
    keepPreviousData: true
  });
}

/** The edit an Open Orders row holds: its quantity and due date. */
const openLineEdit = (row: OpenOrderRow) =>
  row.quantity === null
    ? null
    : ([row.id, { quantity: row.quantity, dueDate: row.dueDate }] as const);

/** What the purchasing route answers a cell save (`updateLine`). */
type UpdateLineResult = { success?: boolean; message?: string };

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
  /** The row's planning horizon (ISO date), or null when it has none. */
  horizonDate: string | null;
  /** True when the horizon was moved on screen, away from the saved one. */
  isHorizonOverridden: boolean;
  /** Move this row's horizon without leaving the drawer — the same on-screen
   *  override as the grid's Planning Horizon cell. `null` clears it for this
   *  view. The suggested orders re-split around the new date. */
  onHorizonChange: (date: string | null) => void;
  /** The item's change actions on existing orders, inside the fence. Each one
   *  is shown on the row of the order it targets. */
  actions: PlanningAction[];
  /** Apply / dismiss / reopen / assign, owned by the grid (one fetcher). */
  actionHandlers: PlanningActionHandlers;
  periods: { id: string; startDate: string; endDate: string }[];
  selectedItem: PurchasingPlanningItem;
  selectedSupplier: string;
  onClose: () => void;
  onSupplierChange: (itemId: string, supplierId: string) => void;
  setOrders: (item: PurchasingPlanningItem, orders: PlannedOrder[]) => void;
  /** Drop the item's draft list so the drawer re-seeds from the suggestions. */
  onSuggestionsStale: (item: PurchasingPlanningItem) => void;
  /** Bumped by the grid each time it drops a row's draft (an Apply on a
   *  planned order re-runs MRP): closes a cell editor left open. */
  draftVersion?: number;
  /** The item's Buy planned orders, as the Planned Orders section reads
   *  them: the suggested orders stand for them. */
  onPlannedOrdersLoaded: (
    item: PurchasingPlanningItem,
    orders: DrawerPlannedOrder[]
  ) => void;
  setSelectedItem: Dispatch<SetStateAction<PurchasingPlanningItem | null>>;
};

export const PurchasingPlanningOrderDrawer = memo(
  ({
    selectedItem,
    setSelectedItem,
    orders,
    beyondFenceOrders,
    horizonDate,
    isHorizonOverridden,
    onHorizonChange,
    actions,
    actionHandlers,
    setOrders,
    onSuggestionsStale,
    draftVersion = 0,
    onPlannedOrdersLoaded,
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
    const horizonLabel = horizonDate
      ? formatDate(horizonDate, undefined, locale)
      : null;
    const pastStartToast = usePastStartToast();

    const formatQuantity = useQuantityFormatter();
    const unitOfMeasureOptions = useUnitOfMeasure();

    const [activeTab, setActiveTab] = useState("ordering");
    const showOrdering = useCallback(() => setActiveTab("ordering"), []);

    const {
      suggestionsVersion,
      bumpSuggestionsVersion,
      // A planned order firmed, unfirmed or edited here re-ran MRP: the
      // suggestions are rebuilt from the re-planned actions and orders.
      reseedSuggestions,
      onPlannedOrdersRead,
      // an action on a planned order sits on its row in the Planned Orders grid
      orderActions: lineActions
    } = useDrawerSuggestions({
      row: selectedItem,
      actions,
      onSuggestionsStale,
      onPlannedOrdersLoaded
    });
    // Bumped to read the planned orders again after an order placed with the
    // drawer left open: it converted some, and the re-seed dropped the row's
    // copy of them.
    const [plannedOrdersVersion, setPlannedOrdersVersion] = useState(0);
    const submittedOrders = useRef<PlannedOrder[]>([]);

    // The order's answer. A refusal is toasted here. On success the orders
    // refused for starting in the past stay in the drawer as they were sent;
    // with none it re-seeds from the suggestions, which keep what was not
    // ordered.
    const fetcher = useAction<typeof bulkUpdateAction>({
      onError: (result) => {
        if ("message" in result && result.message) {
          toastError(result.message, result);
        }
      },
      onSuccess: (result) => {
        if (!("purchaseOrders" in result)) return;
        // The route's `respond` spreads each action's data into one
        // `{ success, message }` union, so the order's fields are read here.
        const {
          purchaseOrders = [],
          refusedOrders,
          processedItems = 0,
          warnings = [],
          errors = []
        } = result as OrderPlannedPurchasesOutcome;
        const refused = refusedOrdersOfRow(
          {
            ...selectedItem,
            id: selectedItem.id!,
            orders: submittedOrders.current
          },
          refusedOrders
        );
        const problems = [...warnings, ...errors];
        if (problems.length > 0) toast.error(problems.join(" · "));
        bumpSuggestionsVersion();
        if (refused.length > 0) {
          setOrders(selectedItem, refused);
          toast.error(pastStartToast(processedItems, refused.length));
        } else {
          onSuggestionsStale(selectedItem);
          setPlannedOrdersVersion((version) => version + 1);
        }

        if (purchaseOrders.length === 0) {
          if (refused.length === 0 && errors.length === 0) {
            toast.success(t`Orders submitted`);
          }
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

        // the router's invalidation reads the open lines again
        if (refused.length > 0 || errors.length > 0) return;
        onClose();
      }
    });

    // The chosen supplier's part: its purchase unit and conversion factor.
    const supplierPart = (selectedItem.suppliers as SupplierPart[])?.find(
      (s) => s.supplierId === selectedSupplier
    );

    // ── Open orders: the item's existing PO lines ───────────────────────────
    // Not in the grid's draft list: a cell edit on one of these is SAVED
    // (onSaveOpenOrder), where a suggested order is a draft until Order is
    // pressed. Only while open: the drawer stays mounted on its last item so
    // it can slide out.
    const openLinesQuery = useDrawerOpenPurchaseOrderLines(
      isOpen && selectedItem.id
        ? path.to.api.planningOpenPurchaseLines({
            itemId: selectedItem.id,
            locationId
          })
        : null
    );

    // A cell's saved edit, shown until the read that follows it lands.
    const openLinesOverlay = useAnswerOverlay(openLinesQuery, openLineEdit);

    // `null` while loading, an Error when the read failed.
    const openOrders = useMemo<OpenPurchaseOrder[] | null | Error>(() => {
      if (openLinesOverlay.error) return openLinesOverlay.error;
      const answer = openLinesOverlay.answer;
      if (!answer) return null;
      const detailById = new Map(
        answer.details.map((detail) => [detail.id, detail])
      );

      const lines = answer.lines
        .flatMap((line): OpenPurchaseOrder[] => {
          if (!line.id) return [];
          const detail = detailById.get(line.id);
          const isLocked = isPurchaseOrderLocked(line.status);
          // purchase units: what is still to come on a sent line, the
          // ordered quantity on one that can still be changed
          const quantity = Number(
            (isLocked ? detail?.quantityToReceive : detail?.purchaseQuantity) ??
              0
          );
          return [
            {
              existingId: line.purchaseOrderId ?? undefined,
              existingLineId: line.id,
              existingReadableId: line.purchaseOrderReadableId ?? undefined,
              // inventory units, as the chart's supply rows are
              existingQuantity: line.quantityToReceive ?? 0,
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
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
      // an edit stays on its row: it moves on the read that follows it
      return withEdits(
        lines,
        openLinesOverlay.editsById,
        (order) => order.existingLineId
      );
    }, [
      openLinesOverlay.answer,
      openLinesOverlay.error,
      openLinesOverlay.editsById,
      periods
    ]);

    const openOrderRows = useMemo<OpenOrderRow[] | null | Error>(() => {
      if (!Array.isArray(openOrders)) return openOrders;

      const rows: OpenOrderRow[] = openOrders.map((order) => {
        const action = actionForOrder(
          lineActions,
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
              purchaseUnitsFor(
                Number(action.suggestedQuantity),
                order.conversionFactor
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

      // An action whose line is not in the list gets a read-only row built
      // from the action itself.
      return withOrphanActionRows(rows, lineActions, (action) => ({
        id: action.id,
        documentPath: reviewPathFor(action),
        readableId: action.purchaseOrderReadableId ?? "—",
        status: action.purchaseOrderStatus ?? null,
        quantity: null,
        dueDate: null,
        isEditable: false,
        action,
        suggestedQuantity: Number(action.suggestedQuantity)
      }));
    }, [openOrders, lineActions]);

    const onOpenOrdersChange = openLinesOverlay.keepEdits;

    const onSaveOpenOrder = useSaveOrderCell<
      OpenOrderRow,
      OpenOrderField,
      UpdateLineResult
    >({
      url: path.to.bulkUpdatePurchasingPlanning,
      bodyOf: (row, field, value) => ({
        action: "updateLine",
        locationId,
        line: { id: row.id, field, value }
      }),
      outcomeOf: (ok, result) =>
        ok && result?.success
          ? { saved: true }
          : { saved: false, message: result?.message },
      failureMessage: t`Failed to update purchase order line`,
      reportFailure: (message, result) => toastError(message, result),
      refetch: openLinesQuery.refetch
    });

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
    // open orders (`openOrdersForChart`).
    const chartOrders = useMemo<PlannedOrder[]>(
      () => [
        ...orders,
        ...(Array.isArray(openOrders)
          ? openOrdersForChart(openOrders, actions)
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

    // A new horizon re-seeds the rows too.
    const onHorizonDateChange = useCallback(
      (date: Parameters<typeof onHorizonChange>[0]) => {
        onHorizonChange(date);
        bumpSuggestionsVersion();
      },
      [onHorizonChange, bumpSuggestionsVersion]
    );
    const onIncludeBeyondFence = useCallback(() => {
      if (lastBeyondFenceDate) onHorizonDateChange(lastBeyondFenceDate);
    }, [lastBeyondFenceDate, onHorizonDateChange]);

    const onSuggestedOrdersChange = useCallback(
      (next: PlannedOrder[]) => setOrders(selectedItem, next),
      [selectedItem, setOrders]
    );

    const onAddOrder = useCallback(() => {
      if (selectedItem.id) {
        // the item's lot size in the chosen supplier's purchase units,
        // rounded up as the suggested orders are
        const inventoryQuantity =
          selectedItem.lotSize ?? selectedItem.minimumOrderQuantity ?? 0;
        const newOrder: PlannedOrder = {
          quantity: purchaseUnitsFor(
            inventoryQuantity,
            supplierConversionFactor(selectedItem.suppliers, selectedSupplier)
          ),
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

        submittedOrders.current = ordersWithPeriods;
        const payload = {
          locationId,
          items: [
            {
              id: id,
              // the row's netting segment: a project segment's order is the
              // project's ('' is common)
              planningSegmentId: selectedItem.planningSegmentId ?? "",
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
      [
        fetcher,
        locationId,
        periods,
        selectedSupplier,
        selectedItem.planningSegmentId
      ]
    );

    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          // closing mid-order would lose the result that clears the draft
          if (!open && fetcher.state === "idle") onClose();
        }}
      >
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
                  <LuExternalLink aria-hidden />
                  <span className="sr-only">
                    <Trans>Open item planning</Trans>
                  </span>
                </Link>
              </DrawerTitle>
              {distinctItemText(
                selectedItem.readableIdWithRevision,
                selectedItem.name
              ) && <DrawerDescription>{selectedItem.name}</DrawerDescription>}
              {/* Phones: under the centred title, not over it. */}
              <div className="absolute top-4 right-12 max-md:static max-md:mt-2">
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
                  <DrawerSuppliersTab
                    item={selectedItem}
                    setItem={setSelectedItem}
                    selectedSupplier={selectedSupplier}
                    onSupplierChange={onSupplierChange}
                    orders={orders}
                    setOrders={setOrders}
                    onSupplierChosen={showOrdering}
                  />
                </TabsContent>
                <TabsContent value="ordering" className="flex flex-col gap-4">
                  <PlanningPolicySummary
                    item={selectedItem}
                    horizonDate={horizonDate}
                    isHorizonOverridden={isHorizonOverridden}
                    onHorizonChange={onHorizonDateChange}
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
                            supplierPart?.supplierUnitOfMeasureCode
                        )?.label ??
                          selectedItem.unitOfMeasureCode ??
                          "EA"}
                      </span>
                    </HStack>
                    {(() => {
                      const factor = supplierPart?.conversionFactor ?? 1;
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
                    <DrawerPlannedOrders
                      title={<Trans>Planned Orders</Trans>}
                      isOpen={isOpen}
                      itemId={selectedItem.id ?? ""}
                      locationId={locationId}
                      planningSegmentId={selectedItem.planningSegmentId}
                      orderType="Buy"
                      updatePath={path.to.bulkUpdatePurchasingPlanning}
                      todayIso={locationToday}
                      actions={actions}
                      actionHandlers={actionHandlers}
                      refreshKey={plannedOrdersVersion}
                      onOrdersLoaded={onPlannedOrdersRead}
                      onReplanned={reseedSuggestions}
                    />

                    <SuggestedOrdersGrid<PlannedOrder>
                      title={<Trans>Suggested Orders</Trans>}
                      titleAction={
                        lastBeyondFenceDate &&
                        horizonDate && (
                          <BeyondFenceButton
                            count={beyondFenceOrders.length}
                            fenceLabel={horizonLabel}
                            onClick={onIncludeBeyondFence}
                          />
                        )
                      }
                      orders={orders}
                      leadTime={selectedItem.leadTime ?? 0}
                      todayIso={locationToday}
                      quantityHeader={t`Purchase Qty`}
                      orderByHeader={t`Order By`}
                      resetKey={suggestionsVersion + draftVersion}
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
                      timeFenceDate={horizonDate}
                      plannedOrders={chartOrders}
                      conversionFactor={supplierPart?.conversionFactor ?? 1}
                    />
                  </DeferredDrawerSections>
                </TabsContent>
              </div>
            </DrawerBody>
            <DrawerFooter>
              <Button
                variant="secondary"
                onClick={onClose}
                isDisabled={fetcher.state !== "idle"}
              >
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
