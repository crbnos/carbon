// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  RefreshRate,
  useAction,
  useLoaderQuery,
  useRevalidator
} from "@carbon/query";
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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuExternalLink } from "react-icons/lu";
import { Link } from "react-router";
import { getLinkToItemPlanning } from "~/modules/items/ui/Item/ItemForm";
import { ItemPlanningChart } from "~/modules/items/ui/Item/ItemPlanningChart";
import type { ProductionOrder } from "~/modules/production/production.models";
import {
  isJobEditableFromPlanning,
  type jobStatus
} from "~/modules/production/production.models";
import type { DrawerPlannedOrder } from "~/modules/production/production.utils";
import type { PlanningAction } from "~/modules/production/types";
import { DrawerPlannedOrders } from "~/modules/production/ui/Planning/DrawerPlannedOrders";
import { refusedOrdersOfRow } from "~/modules/production/ui/Planning/planned-orders-from-actions";
import { chartedOrderQuantity } from "~/modules/production/ui/Planning/planning-increase";
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
import { useJobPlanningRelease } from "~/modules/production/ui/Planning/useJobPlanningRelease";
import { usePastStartToast } from "~/modules/production/ui/Planning/usePastStartToast";
import type { loader as openJobsLoader } from "~/routes/api+/production.planning-open-jobs";
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

/**
 * The item's open make-to-stock jobs at the location, read through
 * `api+/production.planning-open-jobs`. Any action through the router marks
 * the read stale (the root invalidation middleware), so it follows an Apply
 * and an order placed. `refreshKey` reads again after a change the router
 * does not see (Plan and a cell save are plain fetches), and after the drawer
 * re-seeds, which drops the row's copy of the planned orders.
 */
function useDrawerOpenJobs(args: { url: string | null; refreshKey: number }) {
  const { url, refreshKey } = args;
  const query = useLoaderQuery<typeof openJobsLoader>(url, {
    staleTime: RefreshRate.High,
    // the drawer remounts per item, so this only keeps the list on screen
    // while a closed drawer slides out
    keepPreviousData: true
  });
  const { refetch } = query;
  const lastRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === lastRefreshKey.current) return;
    lastRefreshKey.current = refreshKey;
    if (url) void refetch();
  }, [refreshKey, url, refetch]);
  return query;
}

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
   *  suggestions — after an order is placed for the item. */
  onSuggestionsStale: (item: ProductionPlanningItem) => void;
  /** MRP re-ran for the company — a Draft job planned or released, or a
   *  planned order firmed, unfirmed or edited. Its component rows may have
   *  new suggestions too, so every row's draft is dropped. */
  onPlanReran: () => void;
  /** Bumped by the grid each time it drops a row's draft (an Apply on a
   *  planned order re-runs MRP): closes a cell editor left open. */
  draftVersion?: number;
  /** The item's Make planned orders, as the Planned Orders section reads
   *  them: the suggested jobs stand for them. */
  onPlannedOrdersLoaded: (
    item: ProductionPlanningItem,
    orders: DrawerPlannedOrder[]
  ) => void;
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
    onPlanReran,
    draftVersion = 0,
    onPlannedOrdersLoaded,
    locationId,
    periods,
    isOpen,
    onClose,
    locationToday
  }: ProductionPlanningOrderDrawerProps) => {
    const { revalidate } = useRevalidator();
    const { t } = useLingui();
    const pastStartToast = usePastStartToast();
    // Bumped when the rows are re-read, to close any cell editor left open.
    const [suggestionsVersion, setSuggestionsVersion] = useState(0);
    const reseedSuggestions = useCallback(() => {
      onSuggestionsStale(row);
      setSuggestionsVersion((version) => version + 1);
    }, [onSuggestionsStale, row]);
    const reseedAfterReplan = useCallback(() => {
      onPlanReran();
      setSuggestionsVersion((version) => version + 1);
    }, [onPlanReran]);
    const submittedOrders = useRef<ProductionOrder[]>([]);
    // A refusal is toasted by useAction. On success the orders refused for
    // starting in the past stay in the drawer as they were sent; with none,
    // it re-seeds from the suggestions, which keep what was not ordered.
    const fetcher = useAction<typeof bulkUpdateAction>({
      onSuccess: (result) => {
        const data = "data" in result ? result.data : null;
        const refused = refusedOrdersOfRow(
          { ...row, id: row.id!, orders: submittedOrders.current },
          data && "refusedOrders" in data ? data.refusedOrders : []
        );
        if (refused.length > 0) {
          setOrders(row, refused);
          setSuggestionsVersion((version) => version + 1);
        } else {
          reseedSuggestions();
        }
        const problems =
          data && "warnings" in data ? [...data.warnings, ...data.errors] : [];
        if (problems.length > 0) toast.error(problems.join(" · "));
        const failed = data && "errors" in data && data.errors.length > 0;
        if (refused.length === 0 && !failed) {
          toast.success(t`Orders submitted`);
          onClose();
          return;
        }
        const created = data && "jobs" in data ? data.jobs.length : 0;
        setOpenJobsVersion((version) => version + 1);
        if (refused.length > 0) {
          toast.error(pastStartToast(created, refused.length));
        } else if (created > 0) {
          toast.success(t`Orders submitted`);
        }
      }
    });
    const { locale } = useLocale();
    const fenceLabel = timeFenceDate
      ? formatDate(timeFenceDate, undefined, locale)
      : null;

    // ── Open jobs: the item's existing make-to-stock jobs ───────────────────
    // Held here, not in the grid's draft list: a cell edit on one of these is
    // SAVED (onSaveOpenJob), where a suggested job is a draft until Make is
    // pressed. `null` while loading, an Error when the read failed.
    //
    // Released jobs (Ready / In Progress / Paused) are listed too, read-only:
    // MRP raises actions on them, and an action needs its job's row to sit on.
    //
    // Bumped after a Draft job is planned or released here, or an order is
    // placed, to read the list again.
    const [openJobsVersion, setOpenJobsVersion] = useState(0);

    // Only while open: the drawer stays mounted on its last item so it can
    // slide out.
    const openJobsQuery = useDrawerOpenJobs({
      url:
        isOpen && row.id
          ? path.to.api.planningOpenJobs({ itemId: row.id, locationId })
          : null,
      refreshKey: openJobsVersion
    });

    // A cell's saved edit, shown until the read that follows it lands. Kept
    // against the answer it edited, so a newer answer replaces it.
    const [openJobEdits, setOpenJobEdits] = useState<{
      of: unknown;
      byId: Map<string, { quantity: number; dueDate: string | null }>;
    } | null>(null);

    const openJobs = useMemo<OpenProductionOrder[] | null | Error>(() => {
      if (openJobsQuery.error) {
        return openJobsQuery.error instanceof Error
          ? openJobsQuery.error
          : new Error(String(openJobsQuery.error));
      }
      if (!openJobsQuery.data) return null;
      const byId =
        openJobEdits?.of === openJobsQuery.data ? openJobEdits.byId : null;
      return openJobsQuery.data.jobs
        .map((job): OpenProductionOrder => {
          const edit = byId?.get(job.id);
          return {
            existingId: job.id,
            existingReadableId: job.jobId,
            // a Draft job is not supply yet, so all of it is new to the chart
            existingQuantity: job.status === "Draft" ? 0 : job.quantity,
            existingStatus: job.status,
            startDate: job.startDate ?? null,
            dueDate: edit ? edit.dueDate : (job.dueDate ?? null),
            quantity: edit ? edit.quantity : job.quantity,
            loadedQuantity: job.quantity,
            isASAP: job.deadlineType === "ASAP",
            periodId: periodIdFor(periods, job.dueDate)
          };
        })
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
    }, [openJobsQuery.data, openJobsQuery.error, openJobEdits, periods]);

    const onPlannedOrdersRead = useCallback(
      (plannedOrders: DrawerPlannedOrder[]) =>
        onPlannedOrdersLoaded(row, plannedOrders),
      [onPlannedOrdersLoaded, row]
    );

    // An action on a planned order sits on its row in the Planned Orders grid.
    const jobActions = useMemo(
      () => actions.filter((action) => !action.plannedOrderId),
      [actions]
    );

    const openJobRows = useMemo<OpenOrderRow[] | null | Error>(() => {
      if (!Array.isArray(openJobs)) return openJobs;

      const rows: OpenOrderRow[] = openJobs.map((job) => {
        const action = actionForOrder(
          jobActions,
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
      for (const action of jobActions) {
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
    }, [openJobs, jobActions]);

    const openJobsData = openJobsQuery.data;
    const onOpenJobsChange = useCallback(
      (rows: OpenOrderRow[]) => {
        if (!openJobsData) return;
        const byId = new Map<
          string,
          { quantity: number; dueDate: string | null }
        >();
        for (const updated of rows) {
          if (updated.quantity === null) continue;
          byId.set(updated.id, {
            quantity: updated.quantity,
            dueDate: updated.dueDate
          });
        }
        setOpenJobEdits({ of: openJobsData, byId });
      },
      [openJobsData]
    );

    // One cell, one field, one request. The route re-reads the job under the
    // company and refuses one that has been released, so a stale row here
    // cannot edit a job on the floor.
    const { refetch: refetchOpenJobs } = openJobsQuery;
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
            data: { warning: string | null } | null;
            error: { message: string } | null;
          } | null;
          if (response.ok && result?.data) {
            // Saved, but a follow-up step failed: keep the new value and say so.
            if (result.data.warning) toast.error(result.data.warning);
            // A plain fetch bypasses the router's invalidation: read the open
            // jobs again, and refresh the grid row behind the drawer, which
            // otherwise shows the old value until the next navigation.
            void refetchOpenJobs();
            void revalidate();
            return true;
          }
          toast.error(result?.error?.message ?? t`Failed to update job`);
          return false;
        } catch {
          toast.error(t`Failed to update job`);
          return false;
        }
      },
      [locationId, refetchOpenJobs, revalidate, t]
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
            data: { warning: string | null } | null;
            error: { message: string } | null;
          } | null;
          if (response.ok && result?.data) {
            if (result.data.warning) toast.error(result.data.warning);
            else toast.success(t`Planned job`);
            // MRP ran: the suggestions, the grid row and this list all moved
            reseedAfterReplan();
            setOpenJobsVersion((version) => version + 1);
            void revalidate();
          } else {
            toast.error(result?.error?.message ?? t`Failed to plan job`);
          }
        } catch {
          toast.error(t`Failed to plan job`);
        } finally {
          setPlanningJobId(null);
        }
      },
      [locationId, reseedAfterReplan, revalidate, t]
    );

    // Release: a Planned job goes to the floor from here, without waiting for
    // MRP's Release suggestion (raised only the day before the job must
    // start). It runs the jobs table's release, so the job page's checks, the
    // schedule run and the release picking list all apply.
    const [releasingJobId, setReleasingJobId] = useState<string | null>(null);
    const { onReleaseJob, isReleasing } = useJobPlanningRelease({
      onReleased: () => {
        // MRP ran in the release: the suggestions and this list moved
        reseedAfterReplan();
        setOpenJobsVersion((version) => version + 1);
      }
    });
    const releaseJob = useCallback(
      (jobId: string) => {
        setReleasingJobId(jobId);
        onReleaseJob(jobId);
      },
      [onReleaseJob]
    );

    // Left-aligned: the Suggestion column runs past the drawer's width, so a
    // button at its right end sits off screen.
    const renderPlanCommand = useCallback(
      (openRow: OpenOrderRow) => {
        if (!actionHandlers.canUpdate) return null;
        if (openRow.status === "Draft") {
          return (
            <div className="flex">
              <Button
                size="sm"
                variant="secondary"
                isLoading={planningJobId === openRow.id}
                isDisabled={planningJobId !== null || isReleasing}
                onClick={() => onPlanDraftJob(openRow.id)}
              >
                <Trans>Plan</Trans>
              </Button>
            </div>
          );
        }
        if (openRow.status === "Planned") {
          return (
            <div className="flex">
              <Button
                size="sm"
                variant="secondary"
                isLoading={isReleasing && releasingJobId === openRow.id}
                isDisabled={isReleasing || planningJobId !== null}
                onClick={() => releaseJob(openRow.id)}
              >
                <Trans>Release</Trans>
              </Button>
            </div>
          );
        }
        return null;
      },
      [
        actionHandlers.canUpdate,
        onPlanDraftJob,
        planningJobId,
        isReleasing,
        releasingJobId,
        releaseJob
      ]
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

    // A new fence re-seeds the rows too.
    const onFenceChange = useCallback(
      (date: Parameters<typeof onTimeFenceChange>[0]) => {
        onTimeFenceChange(date);
        setSuggestionsVersion((version) => version + 1);
      },
      [onTimeFenceChange]
    );
    const onIncludeBeyondFence = useCallback(() => {
      if (lastBeyondFenceDate) onFenceChange(lastBeyondFenceDate);
    }, [lastBeyondFenceDate, onFenceChange]);

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

        submittedOrders.current = ordersWithPeriods;
        const payload = {
          locationId,
          items: [
            {
              id: id,
              // the row's netting segment: a project segment's job is the
              // project's ('' is common)
              planningSegmentId: row.planningSegmentId ?? "",
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
      [fetcher, locationId, periods, row.planningSegmentId]
    );

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
                <LuExternalLink aria-hidden />
                <span className="sr-only">
                  <Trans>Open item planning</Trans>
                </span>
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
                onFenceChange={onFenceChange}
              />

              <DeferredDrawerSections>
                <DrawerPlannedOrders
                  title={<Trans>Planned Orders</Trans>}
                  isOpen={isOpen}
                  itemId={row.id ?? ""}
                  locationId={locationId}
                  planningSegmentId={row.planningSegmentId}
                  orderType="Make"
                  updatePath={path.to.bulkUpdateProductionPlanning}
                  todayIso={locationToday}
                  actions={actions}
                  actionHandlers={actionHandlers}
                  refreshKey={openJobsVersion}
                  onOrdersLoaded={onPlannedOrdersRead}
                  onReplanned={reseedAfterReplan}
                />

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
                  resetKey={suggestionsVersion + draftVersion}
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
            <Button
              variant="secondary"
              onClick={onClose}
              isDisabled={fetcher.state !== "idle"}
            >
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
        suggestionsVersion,
        draftVersion,
        reseedAfterReplan,
        lastBeyondFenceDate,
        beyondFenceOrders,
        onIncludeBeyondFence,
        openJobRows,
        renderOpenJobStatus,
        renderPlanCommand,
        onSaveOpenJob,
        onOpenJobsChange,
        actionHandlers,
        actions,
        isOpen,
        chartOrders,
        locationToday,
        timeFenceDate,
        isTimeFenceOverridden,
        onFenceChange,
        fenceLabel,
        openJobsVersion,
        onPlannedOrdersRead,
        t
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
        {drawerContent}
      </Drawer>
    );
  }
);

ProductionPlanningOrderDrawer.displayName = "ProductionPlanningOrderDrawer";
