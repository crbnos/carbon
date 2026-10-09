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
  toast
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import { Link, useFetcher } from "react-router";
import { getLinkToItemPlanning } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import type { PlanningAction, ProductionOrder } from "~/modules/production";
import {
  isJobEditableFromPlanning,
  type jobStatus
} from "~/modules/production/production.models";
import type { PlanningActionHandlers } from "~/modules/production/ui/Planning/PlanningActionLines";
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
import type { action as bulkUpdateAction } from "~/routes/x+/production+/planning.update";
import { path } from "~/utils/path";
import type { ProductionPlanningItem } from "../../types";
import { JobStatus } from "../Jobs";

/** An existing job in the planned-order shape the chart reads, plus the
 *  quantity it was read at (so the chart can tell a planner's edit from the
 *  stored job). */
type OpenProductionOrder = ProductionOrder & {
  existingId: string;
  loadedQuantity: number;
};

type ProductionPlanningOrderDrawerProps = {
  /**
   * Today on the plant's calendar (the planning loader's `locationToday`).
   * Planned-order defaults are business dates there, and "late" is measured
   * from it, never from the planner's browser zone.
   */
  locationToday: string;
  row: ProductionPlanningItem;
  orders: ProductionOrder[];
  /** Suggested orders required AFTER the row's time fence. The drawer opens
   *  without them; one button extends the fence to take them in. */
  beyondFenceOrders: ProductionOrder[];
  /** The row's time fence (ISO date), or null when it has none. */
  timeFenceDate: string | null;
  /** True when the fence was moved on screen, away from the saved horizon. */
  isTimeFenceOverridden: boolean;
  /** Move this row's fence without leaving the drawer — the same on-screen
   *  override as the grid's Planning Horizon cell. `null` clears the fence
   *  for this view. The suggested orders re-split around the new date. */
  onTimeFenceChange: (date: string | null) => void;
  /** The item's change actions on existing jobs, inside the fence. Each one is
   *  shown on the row of the job it targets. */
  actions: PlanningAction[];
  /** Apply / dismiss / reopen / assign, owned by the grid (one fetcher). */
  actionHandlers: PlanningActionHandlers;
  setOrders: (item: ProductionPlanningItem, orders: ProductionOrder[]) => void;
  /** Drop the item's draft list so the drawer re-seeds from MRP's new
   *  suggestions — after a Draft job is planned, which re-runs MRP. */
  onSuggestionsStale: (item: ProductionPlanningItem) => void;
  locationId: string;
  periods: { id: string; startDate: string; endDate: string }[];
  isOpen: boolean;
  onClose: () => void;
};

export const ProductionPlanningOrderDrawer = memo(
  ({
    row,
    orders,
    beyondFenceOrders,
    timeFenceDate,
    isTimeFenceOverridden,
    onTimeFenceChange,
    actions,
    actionHandlers,
    setOrders,
    onSuggestionsStale,
    locationId,
    periods,
    isOpen,
    onClose,
    locationToday
  }: ProductionPlanningOrderDrawerProps) => {
    const fetcher = useFetcher<typeof bulkUpdateAction>();
    const { revalidate } = useRevalidator();
    const { t } = useLingui();
    const { locale } = useLocale();
    const fenceLabel = timeFenceDate
      ? formatDate(timeFenceDate, undefined, locale)
      : null;
    const { carbon } = useCarbon();

    // ── Open jobs: the item's existing make-to-stock jobs ───────────────────
    // Held here, not in the grid's draft list: a cell edit on one of these is
    // SAVED (onSaveOpenJob), where a suggested job is a draft until Make is
    // pressed. `null` while loading, an Error when the read failed.
    //
    // Released jobs (Ready / In Progress / Paused) are listed too, read-only:
    // MRP raises actions on them, and an action needs its job's row to sit on.
    const [openJobs, setOpenJobs] = useState<
      OpenProductionOrder[] | null | Error
    >(null);

    // Re-read when the item's actions change: applying one rewrites its job.
    const actionsKey = actions.map((a) => `${a.id}:${a.status}`).join(",");
    // ...and after a Draft job is planned here, which changes its status.
    const [openJobsVersion, setOpenJobsVersion] = useState(0);

    // Only while open: the drawer stays mounted on its last item so it can
    // slide out, and that item's actions change with every Apply on the grid.
    // biome-ignore lint/correctness/useExhaustiveDependencies: actionsKey stands in for `actions`; periods are fixed for the page
    useEffect(() => {
      if (!isOpen || !carbon || !row.id) return;
      let isCurrent = true;

      (async () => {
        const jobs = await carbon
          .from("job")
          .select(
            "id, jobId, status, quantity, startDate, dueDate, deadlineType"
          )
          .eq("itemId", row.id)
          // this page's location only: the rows are editable and charted here
          .eq("locationId", locationId)
          .is("salesOrderId", null)
          .is("salesOrderLineId", null)
          .in("status", ["Draft", "Planned", "Ready", "In Progress", "Paused"]);
        if (!isCurrent) return;
        if (jobs.error) {
          setOpenJobs(new Error(jobs.error.message));
          return;
        }

        setOpenJobs(
          (jobs.data ?? [])
            .map(
              (job): OpenProductionOrder => ({
                existingId: job.id,
                existingReadableId: job.jobId,
                // a Draft job is not supply yet, so all of it is new to the chart
                existingQuantity: job.status === "Draft" ? 0 : job.quantity,
                existingStatus: job.status,
                startDate: job.startDate ?? null,
                dueDate: job.dueDate ?? null,
                quantity: job.quantity,
                loadedQuantity: job.quantity,
                isASAP: job.deadlineType === "ASAP",
                periodId: periodIdFor(periods, job.dueDate)
              })
            )
            .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
        );
      })();

      return () => {
        isCurrent = false;
      };
    }, [isOpen, carbon, row.id, locationId, actionsKey, openJobsVersion]);

    const openJobRows = useMemo<OpenOrderRow[] | null | Error>(() => {
      if (!Array.isArray(openJobs)) return openJobs;

      const rows: OpenOrderRow[] = openJobs.map((job) => {
        const action = actionForOrder(
          actions,
          (a) => a.jobId === job.existingId
        );
        return {
          id: job.existingId,
          documentPath: path.to.job(job.existingId),
          readableId: job.existingReadableId ?? "",
          status: job.existingStatus ?? null,
          quantity: job.quantity,
          dueDate: job.dueDate ?? null,
          isEditable: isJobEditableFromPlanning(job.existingStatus),
          action,
          suggestedQuantity: action ? Number(action.suggestedQuantity) : null
        };
      });

      // An action whose job is not in the list still has to be shown — a
      // suggestion that silently drops out of the drawer reads as "nothing to
      // do". It gets a read-only row built from the action itself.
      for (const action of actions) {
        if (rows.some((r) => r.action?.id === action.id)) continue;
        rows.push({
          id: action.id,
          documentPath: action.jobId ? path.to.job(action.jobId) : null,
          readableId: action.jobReadableId ?? "—",
          status: action.jobStatus ?? null,
          quantity: null,
          dueDate: null,
          isEditable: false,
          action,
          suggestedQuantity: Number(action.suggestedQuantity)
        });
      }

      return rows;
    }, [openJobs, actions]);

    const onOpenJobsChange = useCallback((rows: OpenOrderRow[]) => {
      setOpenJobs((previous) =>
        Array.isArray(previous)
          ? previous.map((job) => {
              const updated = rows.find((r) => r.id === job.existingId);
              return updated && updated.quantity !== null
                ? {
                    ...job,
                    quantity: updated.quantity,
                    dueDate: updated.dueDate
                  }
                : job;
            })
          : previous
      );
    }, []);

    // One cell, one field, one request. The route re-reads the job under the
    // company and refuses one that has been released, so a stale row here
    // cannot edit a job on the floor.
    const onSaveOpenJob = useCallback(
      async (
        openRow: OpenOrderRow,
        field: OpenOrderField,
        value: number | string
      ) => {
        try {
          const response = await fetch(path.to.bulkUpdateProductionPlanning, {
            method: "post",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "updateJob",
              locationId,
              job: { id: openRow.id, field, value }
            })
          });
          const result = (await response.json().catch(() => null)) as {
            success?: boolean;
            message?: string;
            warning?: string;
          } | null;
          if (response.ok && result?.success) {
            // Saved, but a follow-up step failed: keep the new value and say so.
            if (result.warning) toast.error(result.warning);
            // A plain fetch bypasses the router: refresh the grid row behind
            // the drawer, which otherwise shows the old value until the next
            // navigation.
            void revalidate();
            return true;
          }
          toast.error(result?.message ?? t`Failed to update job`);
          return false;
        } catch {
          toast.error(t`Failed to update job`);
          return false;
        }
      },
      [locationId, revalidate, t]
    );

    // Plan: a Draft job becomes Planned, so MRP counts it as supply. Draft is
    // the planner's own unfinished job; without this it sat beside a Make
    // suggestion for the same need, and both could be built. Edit its
    // quantity and date in the row first — Plan keeps them.
    const [planningJobId, setPlanningJobId] = useState<string | null>(null);
    const onPlanDraftJob = useCallback(
      async (jobId: string) => {
        setPlanningJobId(jobId);
        try {
          const response = await fetch(path.to.bulkUpdateProductionPlanning, {
            method: "post",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "planJob",
              locationId,
              job: { id: jobId }
            })
          });
          const result = (await response.json().catch(() => null)) as {
            success?: boolean;
            message?: string;
            warning?: string;
          } | null;
          if (response.ok && result?.success) {
            if (result.warning) toast.error(result.warning);
            else toast.success(t`Planned job`);
            // MRP ran: the suggestions, the grid row and this list all moved
            onSuggestionsStale(row);
            setOpenJobsVersion((version) => version + 1);
            void revalidate();
          } else {
            toast.error(result?.message ?? t`Failed to plan job`);
          }
        } catch {
          toast.error(t`Failed to plan job`);
        } finally {
          setPlanningJobId(null);
        }
      },
      [locationId, onSuggestionsStale, revalidate, row, t]
    );

    const renderPlanCommand = useCallback(
      (openRow: OpenOrderRow) =>
        openRow.status === "Draft" && actionHandlers.canUpdate ? (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="secondary"
              isLoading={planningJobId === openRow.id}
              isDisabled={planningJobId !== null}
              onClick={() => onPlanDraftJob(openRow.id)}
            >
              <Trans>Plan</Trans>
            </Button>
          </div>
        ) : null,
      [actionHandlers.canUpdate, onPlanDraftJob, planningJobId]
    );

    const renderOpenJobStatus = useCallback(
      (status: string) => (
        <JobStatus iconOnly status={status as (typeof jobStatus)[number]} />
      ),
      []
    );

    // What the chart overlays as planned supply: the draft jobs, plus the jobs
    // a planner can still change so an edit shows before MRP runs again, and
    // any job with an open Increase — charted at it, since it took the place
    // of a draft job.
    const chartOrders = useMemo<ProductionOrder[]>(
      () =>
        Array.isArray(openJobs)
          ? [
              ...orders,
              ...openJobs.flatMap(({ loadedQuantity, ...job }) => {
                const increase = actionForOrder(
                  actions,
                  (a) => a.type === "Increase" && a.jobId === job.existingId
                );
                if (!increase && !isJobEditableFromPlanning(job.existingStatus))
                  return [];
                return [
                  {
                    ...job,
                    quantity: chartedOrderQuantity({
                      quantity: job.quantity,
                      loadedQuantity,
                      increase
                    })
                  }
                ];
              })
            ]
          : orders,
      [orders, openJobs, actions]
    );

    const onSuggestedOrdersChange = useCallback(
      (next: ProductionOrder[]) => setOrders(row, next),
      [row, setOrders]
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

    // Memoize handlers
    const onAddOrder = useCallback(() => {
      if (row.id) {
        const newOrder: ProductionOrder = {
          quantity: row.lotSize || row.minimumOrderQuantity || 1,
          dueDate: parseDate(locationToday)
            .add({ days: row.leadTime ?? 0 })
            .toString(),
          startDate: locationToday,
          isASAP: false,
          periodId: periods[0].id
        };
        setOrders(row, [...orders, newOrder]);
      }
    }, [row, orders, setOrders, periods, locationToday]);

    const onSubmit = useCallback(
      (id: string, orders: ProductionOrder[]) => {
        const ordersWithPeriods = orders.map((order) => {
          // If no due date or due date is before first period, use first period
          return {
            ...order,
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
          action: path.to.bulkUpdateProductionPlanning,
          encType: "application/json"
        });
      },
      [fetcher, locationId, periods]
    );

    // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
    useEffect(() => {
      if (fetcher.data?.success === false && fetcher?.data?.message) {
        toast.error(fetcher.data.message);
      }

      if (fetcher.data?.success === true) {
        toast.success(t`Orders submitted`);
        setOrders(row, []);
        onClose();
      }
    }, [fetcher.data?.success]);

    // Memoize drawer content
    const drawerContent = useMemo(
      () => (
        <DrawerContent size="lg">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-2">
              <span>{row.readableIdWithRevision}</span>
              <Link
                // @ts-expect-error
                to={getLinkToItemPlanning(row.type, row.id)}
              >
                <LuExternalLink />
              </Link>
            </DrawerTitle>
            <DrawerDescription>{row.name}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <div className="flex flex-col gap-4  w-full">
              <PlanningPolicySummary
                item={row}
                fenceDate={timeFenceDate}
                isFenceOverridden={isTimeFenceOverridden}
                onFenceChange={onTimeFenceChange}
              />

              <DeferredDrawerSections>
                <SuggestedOrdersGrid<ProductionOrder>
                  title={<Trans>Suggested Jobs</Trans>}
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
                  leadTime={row.leadTime ?? 0}
                  todayIso={locationToday}
                  quantityHeader={t`Quantity`}
                  orderByHeader={t`Start By`}
                  onChange={onSuggestedOrdersChange}
                  onAdd={onAddOrder}
                />

                <OpenOrdersGrid
                  title={<Trans>Open Jobs</Trans>}
                  documentHeader={t`Job`}
                  quantityHeader={t`Qty`}
                  rows={openJobRows}
                  todayIso={locationToday}
                  renderStatusIcon={renderOpenJobStatus}
                  renderRowCommand={renderPlanCommand}
                  onSave={onSaveOpenJob}
                  onRowsChange={onOpenJobsChange}
                  {...actionHandlers}
                />

                <ItemPlanningChart
                  compact
                  itemId={row.id}
                  locationId={locationId}
                  safetyStock={row.demandAccumulationSafetyStock}
                  timeFenceDate={timeFenceDate}
                  plannedOrders={chartOrders}
                />
              </DeferredDrawerSections>
            </div>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Close</Trans>
            </Button>
            <Button
              variant="primary"
              onClick={() => onSubmit(row.id, orders)}
              disabled={fetcher.state !== "idle" || orders.length === 0}
              isDisabled={fetcher.state !== "idle" || orders.length === 0}
              isLoading={fetcher.state !== "idle"}
            >
              <Trans>Make</Trans>
            </Button>
          </DrawerFooter>
        </DrawerContent>
      ),
      [
        row,
        orders,
        locationId,
        fetcher.state,
        onClose,
        onAddOrder,
        onSubmit,
        onSuggestedOrdersChange,
        lastBeyondFenceDate,
        beyondFenceOrders,
        onIncludeBeyondFence,
        openJobRows,
        renderOpenJobStatus,
        renderPlanCommand,
        onSaveOpenJob,
        onOpenJobsChange,
        actionHandlers,
        chartOrders,
        locationToday,
        timeFenceDate,
        isTimeFenceOverridden,
        onTimeFenceChange,
        fenceLabel,
        t
      ]
    );

    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
        {drawerContent}
      </Drawer>
    );
  }
);

ProductionPlanningOrderDrawer.displayName = "ProductionPlanningOrderDrawer";
