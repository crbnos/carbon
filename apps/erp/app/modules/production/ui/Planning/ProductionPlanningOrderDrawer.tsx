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
import { memo, useCallback, useMemo, useRef, useState } from "react";
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
import {
  type OpenOrderField,
  type OpenOrderRow,
  OpenOrdersGrid
} from "~/modules/production/ui/Planning/OpenOrdersGrid";
import { refusedOrdersOfRow } from "~/modules/production/ui/Planning/planned-orders-from-actions";
import { chartedOrderQuantity } from "~/modules/production/ui/Planning/planning-increase";
import { actionForOrder } from "~/modules/production/ui/Planning/planning-review";
import type { PlanningActionHandlers } from "~/modules/production/ui/Planning/PlanningActionLines";
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
  useRefetchOnKey,
  useSaveOrderCell,
  withEdits,
  withOrphanActionRows
} from "~/modules/production/ui/Planning/useDrawerOrders";
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
 * and an order placed. `refreshKey` reads again after Plan (a plain fetch),
 * a Release, and an order that left the drawer open. A cell save refetches
 * the list itself (`useSaveOrderCell`).
 */
function useDrawerOpenJobs(args: { url: string | null; refreshKey: number }) {
  const { url, refreshKey } = args;
  const query = useLoaderQuery<typeof openJobsLoader>(url, {
    staleTime: RefreshRate.High,
    // the drawer remounts per item, so this only keeps the list on screen
    // while a closed drawer slides out
    keepPreviousData: true
  });
  useRefetchOnKey(query, url, refreshKey);
  return query;
}

/** The edit an Open Jobs row holds: its quantity and due date. */
const openJobEdit = (row: OpenOrderRow) =>
  row.quantity === null
    ? null
    : ([row.id, { quantity: row.quantity, dueDate: row.dueDate }] as const);

/** What the jobs route answers a cell save (`updateJob`). */
type UpdateJobResult = {
  data: { warning: string | null } | null;
  error: { message: string } | null;
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
  /** The row's planning horizon (ISO date), or null when it has none. */
  horizonDate: string | null;
  /** True when the horizon was moved on screen, away from the saved one. */
  isHorizonOverridden: boolean;
  /** Move this row's horizon without leaving the drawer — the same on-screen
   *  override as the grid's Planning Horizon cell. `null` clears it for this
   *  view. The suggested orders re-split around the new date. */
  onHorizonChange: (date: string | null) => void;
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
    horizonDate,
    isHorizonOverridden,
    onHorizonChange,
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
    const {
      suggestionsVersion,
      bumpSuggestionsVersion,
      reseedSuggestions,
      onPlannedOrdersRead,
      // an action on a planned order sits on its row in the Planned Orders grid
      orderActions: jobActions
    } = useDrawerSuggestions({
      row,
      actions,
      onSuggestionsStale,
      onPlannedOrdersLoaded
    });
    const reseedAfterReplan = useCallback(() => {
      onPlanReran();
      bumpSuggestionsVersion();
    }, [onPlanReran, bumpSuggestionsVersion]);
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
          bumpSuggestionsVersion();
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
    const horizonLabel = horizonDate
      ? formatDate(horizonDate, undefined, locale)
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

    // A cell's saved edit, shown until the read that follows it lands. The
    // edited row stays where it is until then, so it does not move under the
    // cursor; the read that follows sorts it by its new date.
    const openJobsOverlay = useAnswerOverlay(openJobsQuery, openJobEdit);

    const openJobs = useMemo<OpenProductionOrder[] | null | Error>(() => {
      if (openJobsOverlay.error) return openJobsOverlay.error;
      if (!openJobsOverlay.answer) return null;
      const jobs = openJobsOverlay.answer.jobs
        .map((job): OpenProductionOrder => ({
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
        }))
        .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
      return withEdits(
        jobs,
        openJobsOverlay.editsById,
        (job) => job.existingId
      );
    }, [
      openJobsOverlay.answer,
      openJobsOverlay.error,
      openJobsOverlay.editsById,
      periods
    ]);

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

      // An action whose job is not in the list gets a read-only row built
      // from the action itself.
      return withOrphanActionRows(rows, jobActions, (action) => ({
        id: action.id,
        documentPath: action.jobId ? path.to.job(action.jobId) : null,
        readableId: action.jobReadableId ?? "—",
        status: action.jobStatus ?? null,
        quantity: null,
        dueDate: null,
        isEditable: false,
        action,
        suggestedQuantity: Number(action.suggestedQuantity)
      }));
    }, [openJobs, jobActions]);

    const onOpenJobsChange = openJobsOverlay.keepEdits;

    // Saved, but a follow-up step failed (recalculating requirements, telling
    // the scheduler): the new value stands and the warning is shown.
    const onSaveOpenJob = useSaveOrderCell<
      OpenOrderRow,
      OpenOrderField,
      UpdateJobResult
    >({
      url: path.to.bulkUpdateProductionPlanning,
      bodyOf: (openRow, field, value) => ({
        action: "updateJob",
        locationId,
        job: { id: openRow.id, field, value }
      }),
      outcomeOf: (ok, result) =>
        ok && result?.data
          ? { saved: true, warning: result.data.warning }
          : { saved: false, message: result?.error?.message },
      failureMessage: t`Failed to update job`,
      refetch: openJobsQuery.refetch
    });

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
                horizonDate={horizonDate}
                isHorizonOverridden={isHorizonOverridden}
                onHorizonChange={onHorizonDateChange}
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
                    horizonDate && (
                      <BeyondFenceButton
                        count={beyondFenceOrders.length}
                        fenceLabel={horizonLabel}
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
                  timeFenceDate={horizonDate}
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
        horizonDate,
        isHorizonOverridden,
        onHorizonDateChange,
        horizonLabel,
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
