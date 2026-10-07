// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  LuBan,
  LuChevronsDown,
  LuChevronsUp,
  LuCirclePlay,
  LuEllipsisVertical,
  LuEyeOff,
  LuMinus,
  LuPlus,
  LuRotateCcw,
  LuSend,
  LuShoppingCart,
  LuUserCheck,
  LuX
} from "react-icons/lu";
import { Link } from "react-router";
import { Assignee, DateTime } from "~/components";
import { useQuantityFormatter } from "~/hooks";
import type { PlanningAction } from "~/modules/production";
import type { planningActionType } from "~/modules/production/production.models";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { path } from "~/utils/path";
import JobStatus from "../Jobs/JobStatus";
import {
  isPlanningActionLate,
  type PlanningPurchaseOrder,
  planningActionNeedsReview
} from "./planning-review";

// The MRP action worklist (spec §P1.7) rendered INSIDE the planning grid: one
// persisted planningAction per line, shown in the expanded row of the item it
// belongs to. The grid row is the item; the action is the dated decision.

export type PlanningActionType = (typeof planningActionType)[number];

const NEW_SUPPLY_TYPES: ReadonlySet<string> = new Set(["Order", "Make"]);

/** Order/Make rows are fulfilled through the grid's Order button + drawer. */
export function isNewSupplyAction(action: PlanningAction) {
  return NEW_SUPPLY_TYPES.has(action.type);
}

/** One-click Apply: an Open change action whose target is still uncommitted
 *  — read from the order's live status, not MRP's stamp (see planning-review).
 *  A Release is done on the order itself, never applied from here. */
export function isApplyablePlanningAction(action: PlanningAction) {
  return (
    action.status === "Open" &&
    action.type !== "Release" &&
    !planningActionNeedsReview(action) &&
    !isNewSupplyAction(action)
  );
}

/** The purchase order a planning action targets, for its order menu. */
export function planningActionPurchaseOrder(
  action: PlanningAction
): PlanningPurchaseOrder | null {
  if (!action.purchaseOrderId) return null;
  return {
    id: action.purchaseOrderId,
    readableId: action.purchaseOrderReadableId,
    status: action.purchaseOrderStatus,
    orderDate: action.purchaseOrderDate
  };
}

const TYPE_ICONS: Record<PlanningActionType, ReactNode> = {
  Order: <LuShoppingCart />,
  Make: <LuCirclePlay />,
  Expedite: <LuChevronsUp />,
  Defer: <LuChevronsDown />,
  Increase: <LuPlus />,
  Decrease: <LuMinus />,
  Cancel: <LuBan />,
  Release: <LuSend />
};

const TYPE_ORDER: PlanningActionType[] = [
  "Expedite",
  "Cancel",
  "Decrease",
  "Increase",
  "Release",
  "Defer",
  "Order",
  "Make"
];

export function usePlanningActionTypeLabels(): Record<
  PlanningActionType,
  string
> {
  const { t } = useLingui();
  return useMemo(
    () => ({
      Order: t`Order`,
      Make: t`Make`,
      Expedite: t`Expedite`,
      Defer: t`Defer`,
      Increase: t`Increase`,
      Decrease: t`Decrease`,
      Cancel: t`Cancel`,
      Release: t`Release`
    }),
    [t]
  );
}

/** The labelled badge. The label is its CHILD, not looked up inside, because
 *  the table's filter reads an option's text out of the element's children
 *  (`reactNodeToString`) — for the active-filter pill and the option search. */
function LabelledTypeBadge({
  type,
  count,
  children
}: {
  type: PlanningActionType;
  count?: number;
  children: string;
}) {
  return (
    <Badge variant="secondary" className="gap-1 shrink-0 whitespace-nowrap">
      <span className="inline-flex shrink-0 [&>svg]:size-3">
        {TYPE_ICONS[type]}
      </span>
      <span>{children}</span>
      {count !== undefined && count > 1 && (
        <span className="tabular-nums text-muted-foreground">·{count}</span>
      )}
    </Badge>
  );
}

export function PlanningActionTypeBadge({
  type,
  count,
  compact = false
}: {
  type: PlanningActionType;
  count?: number;
  /** Icon and count only; the label moves to a tooltip. */
  compact?: boolean;
}) {
  const labels = usePlanningActionTypeLabels();
  const hasCount = count !== undefined && count > 1;

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="secondary"
            className="gap-1 shrink-0 px-1.5"
            aria-label={labels[type]}
          >
            <span className="inline-flex shrink-0 [&>svg]:size-3">
              {TYPE_ICONS[type]}
            </span>
            {hasCount && <span className="tabular-nums">{count}</span>}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {labels[type]}
          {hasCount && (
            <span className="tabular-nums text-muted-foreground">
              {" "}
              ·{count}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <LabelledTypeBadge type={type} count={count}>
      {labels[type]}
    </LabelledTypeBadge>
  );
}

/** Static filter options for the Actions column: one per type the worklist
 *  can hold, rendered as the same badge the cell shows. Only types that
 *  belong to this grid's kind are offered. */
export function usePlanningActionTypeOptions(kind: "Buy" | "Make") {
  const labels = usePlanningActionTypeLabels();
  return useMemo(() => {
    const types = TYPE_ORDER.filter((type) =>
      kind === "Buy" ? type !== "Make" : type !== "Order"
    );
    return types.map((type) => ({
      value: type,
      label: <LabelledTypeBadge type={type}>{labels[type]}</LabelledTypeBadge>
    }));
  }, [kind, labels]);
}

export { planningActionDot } from "./planning-review";

/** The grid's Actions cell: one ICON chip per open action type (with a count
 *  when the item has several; the name is in its tooltip) and a muted chip for
 *  dismissed rows so they stay reachable from the expanded row. Icons only, so the cell is always ONE line — a
 *  labelled badge per type wrapped and made every busy row taller than its
 *  neighbours. The expanded row shows each action with its full badge. */
export function PlanningActionsCell({
  actions
}: {
  actions: PlanningAction[];
}) {
  const open = actions.filter((a) => a.status === "Open");
  const dismissed = actions.length - open.length;
  if (open.length === 0 && dismissed === 0) return null;

  const counts = new Map<PlanningActionType, number>();
  for (const action of open) {
    counts.set(action.type, (counts.get(action.type) ?? 0) + 1);
  }
  const types = TYPE_ORDER.filter((type) => counts.has(type));

  return (
    <HStack spacing={1} className="flex-nowrap whitespace-nowrap">
      {types.map((type) => (
        <PlanningActionTypeBadge
          key={type}
          type={type}
          count={counts.get(type)}
          compact
        />
      ))}
      {dismissed > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="gap-1 shrink-0 px-1.5 text-muted-foreground"
            >
              <LuEyeOff className="size-3" />
              <span className="tabular-nums">{dismissed}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <Trans>{dismissed} dismissed</Trans>
          </TooltipContent>
        </Tooltip>
      )}
    </HStack>
  );
}

/** CSV value for the Actions column. */
export function planningActionsExportValue(actions: PlanningAction[]) {
  const open = actions.filter((a) => a.status === "Open");
  if (open.length === 0) return null;
  return open.map((a) => a.type).join(", ");
}

/** The document an action changes: its purchase order LINE when it names one
 *  (the line, not the order, is what the action resizes or moves), else the
 *  purchase order, else the job. */
export function reviewPathFor(action: PlanningAction) {
  if (action.purchaseOrderId) {
    return action.purchaseOrderLineId
      ? path.to.purchaseOrderLine(
          action.purchaseOrderId,
          action.purchaseOrderLineId
        )
      : path.to.purchaseOrder(action.purchaseOrderId);
  }
  if (action.jobId) return path.to.job(action.jobId);
  return null;
}

/** Open before dismissed, then by suggested date (YYYY-MM-DD sorts
 *  chronologically as a string), then by the type order above. */
function sortPlanningActions(actions: PlanningAction[]) {
  return [...actions].sort((a, b) => {
    if (a.status !== b.status) return a.status === "Open" ? -1 : 1;
    if (a.suggestedDate !== b.suggestedDate)
      return a.suggestedDate < b.suggestedDate ? -1 : 1;
    return TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
  });
}

export type PlanningActionHandlers = {
  currentUserId: string;
  canUpdate: boolean;
  isBusy: boolean;
  onApply: (ids: string[]) => void;
  onDismiss: (ids: string[]) => void;
  onReopen: (ids: string[]) => void;
  onAssignToMe: (ids: string[]) => void;
  /** Sets the assignee; an empty string unassigns. */
  onAssign: (ids: string[], assignee: string) => void;
  /** The purchasing page's commands on the order itself (Reopen, Reopen as
   *  Revision, Finalize), added to the row's ⋯ menu. Null when there are
   *  none; production passes nothing. */
  purchaseOrderMenuItems?: (order: PlanningPurchaseOrder) => ReactNode;
  /** Releases a Release action's order from the page (purchasing: the PO's
   *  Finalize modal; production: the job release). Absent, the button links
   *  to the order instead. */
  onRelease?: (action: PlanningAction) => void;
};

/** The trailing controls of one action, wherever it is listed: ONE button
 *  (Apply, Review on the committed order, or Order…/Make… for new supply) and
 *  the ⋯ menu with Assign to Me and Dismiss / Reopen. */
export function PlanningActionRowActions({
  action,
  currentUserId,
  canUpdate,
  isBusy,
  onApply,
  onDismiss,
  onReopen,
  onAssignToMe,
  onOrder,
  purchaseOrderMenuItems,
  onRelease,
  purchaseOrder
}: PlanningActionHandlers & {
  action: PlanningAction;
  /** Opens the order drawer for a new-supply action. A host that lists change
   *  actions only (the order drawer itself) omits it. */
  onOrder?: () => void;
  /** The order as the host read it; the action's own enrichment otherwise. */
  purchaseOrder?: PlanningPurchaseOrder | null;
}) {
  const { t } = useLingui();
  const isDismissed = action.status === "Dismissed";
  const reviewPath = planningActionNeedsReview(action)
    ? reviewPathFor(action)
    : null;
  const order = purchaseOrder ?? planningActionPurchaseOrder(action);
  const orderMenuItems =
    order && purchaseOrderMenuItems ? purchaseOrderMenuItems(order) : null;
  const isMine = action.assignee === currentUserId;

  return (
    <div className="flex items-center justify-end gap-1">
      {isDismissed ? (
        <span className="text-xs text-muted-foreground">
          <Trans>Dismissed</Trans>
        </span>
      ) : action.type === "Release" ? (
        // released through the order's own path — from here when the page
        // offers it, else on the order
        onRelease ? (
          <Button
            size="sm"
            variant="secondary"
            isDisabled={!canUpdate || isBusy}
            onClick={() => onRelease(action)}
          >
            <Trans>Release</Trans>
          </Button>
        ) : (
          reviewPathFor(action) && (
            <Button asChild size="sm" variant="secondary">
              <Link to={reviewPathFor(action)!}>
                <Trans>Release</Trans>
              </Link>
            </Button>
          )
        )
      ) : reviewPath ? (
        <Button asChild size="sm" variant="secondary">
          <Link to={reviewPath}>
            <Trans>Review</Trans>
          </Link>
        </Button>
      ) : isNewSupplyAction(action) ? (
        onOrder && (
          <Button
            size="sm"
            variant="secondary"
            isDisabled={!canUpdate || isBusy}
            onClick={onOrder}
          >
            {action.type === "Make" ? t`Make` : t`Order`}
          </Button>
        )
      ) : (
        <Button
          size="sm"
          variant="secondary"
          isDisabled={!canUpdate || isBusy}
          onClick={() => onApply([action.id])}
        >
          <Trans>Apply</Trans>
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={t`More options`}
            icon={<LuEllipsisVertical />}
            isDisabled={!canUpdate}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={isMine || isBusy}
            onSelect={() => onAssignToMe([action.id])}
          >
            <DropdownMenuIcon icon={<LuUserCheck />} />
            <Trans>Assign to Me</Trans>
          </DropdownMenuItem>
          {isDismissed ? (
            <DropdownMenuItem
              disabled={isBusy}
              onSelect={() => onReopen([action.id])}
            >
              <DropdownMenuIcon icon={<LuRotateCcw />} />
              <Trans>Reopen</Trans>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={isBusy}
              onSelect={() => onDismiss([action.id])}
            >
              <DropdownMenuIcon icon={<LuX />} />
              <Trans>Dismiss</Trans>
            </DropdownMenuItem>
          )}
          {orderMenuItems && (
            <>
              <DropdownMenuSeparator />
              {orderMenuItems}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The action's type badge, with MRP's reason as the badge's own tooltip. A
 * sentence per row is a column no width comfortably fits, and a separate info
 * icon beside every badge was a second thing to aim at for the same answer —
 * so the badge is the hover target. It is focusable, so the reason is
 * reachable from the keyboard too.
 */
export function PlanningActionTypeWithReason({
  action
}: {
  action: PlanningAction;
}) {
  const reason = action.reason ?? action.policyName ?? "";
  const badge = <PlanningActionTypeBadge type={action.type} />;

  if (!reason) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // focusable: the tooltip is the only place the reason is shown
          tabIndex={0}
          className="inline-flex shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[360px] whitespace-normal">
        {reason}
        {action.reason && action.policyName && (
          <div className="text-muted-foreground">{action.policyName}</div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

type PlanningActionLinesProps = PlanningActionHandlers & {
  actions: PlanningAction[];
  /** Today on the location's calendar — an action dated before it is late. */
  todayIso: string;
  /** Opens the grid's order drawer for this item (Order / Make rows). */
  onOrder: () => void;
};

/** The order an action changes, as it reads in a sentence: its status icon
 *  (why the row is Review rather than Apply, named on hover) and its number. */
function PlanningActionTarget({ action }: { action: PlanningAction }) {
  const documentId =
    action.purchaseOrderReadableId ?? action.jobReadableId ?? null;
  const documentPath = reviewPathFor(action);
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <PurchasingStatus iconOnly status={action.purchaseOrderStatus} />
      <JobStatus iconOnly status={action.jobStatus} />
      {documentId && documentPath ? (
        <Link to={documentPath} className="hover:underline">
          {documentId}
        </Link>
      ) : (
        <span>{documentId ?? "—"}</span>
      )}
    </span>
  );
}

/** One action as a sentence: "Order 530 for Oct 4, 2026", "Expedite purchase
 *  order PO00129 to Oct 4, 2026". The type's icon leads it and carries MRP's
 *  reason as its tooltip. */
function PlanningActionSentence({
  action,
  isLate
}: {
  action: PlanningAction;
  isLate: boolean;
}) {
  const formatQuantity = useQuantityFormatter();
  const labels = usePlanningActionTypeLabels();
  const reason = action.reason ?? action.policyName ?? "";

  const quantity = formatQuantity(action.suggestedQuantity);
  const amount = <span className="tabular-nums">{quantity}</span>;
  const date = (
    <span className={cn(isLate && "text-red-500")}>
      <DateTime value={action.suggestedDate} variant="date" />
    </span>
  );
  const target = <PlanningActionTarget action={action} />;
  const isJob = action.jobId !== null;

  let sentence: ReactNode;
  switch (action.type) {
    case "Order":
      sentence = (
        <Trans>
          Order {amount} for {date}
        </Trans>
      );
      break;
    case "Make":
      sentence = (
        <Trans>
          Make {amount} for {date}
        </Trans>
      );
      break;
    case "Expedite":
      sentence = isJob ? (
        <Trans>
          Expedite job {target} to {date}
        </Trans>
      ) : (
        <Trans>
          Expedite purchase order {target} to {date}
        </Trans>
      );
      break;
    case "Defer":
      sentence = isJob ? (
        <Trans>
          Defer job {target} to {date}
        </Trans>
      ) : (
        <Trans>
          Defer purchase order {target} to {date}
        </Trans>
      );
      break;
    case "Increase":
      sentence = isJob ? (
        <Trans>
          Increase job {target} to {amount}
        </Trans>
      ) : (
        <Trans>
          Increase purchase order {target} to {amount}
        </Trans>
      );
      break;
    case "Decrease":
      sentence = isJob ? (
        <Trans>
          Decrease job {target} to {amount}
        </Trans>
      ) : (
        <Trans>
          Decrease purchase order {target} to {amount}
        </Trans>
      );
      break;
    case "Cancel":
      sentence = isJob ? (
        <Trans>Cancel job {target}</Trans>
      ) : (
        <Trans>Cancel purchase order {target}</Trans>
      );
      break;
    case "Release":
      sentence = isJob ? (
        <Trans>
          Release job {target} by {date}
        </Trans>
      ) : (
        <Trans>
          Release purchase order {target} by {date}
        </Trans>
      );
      break;
  }

  const icon = (
    <span
      // focusable: the tooltip is the only place the reason is shown
      tabIndex={0}
      role="img"
      aria-label={labels[action.type]}
      className="inline-flex shrink-0 rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-4"
    >
      {TYPE_ICONS[action.type]}
    </span>
  );

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Tooltip>
        <TooltipTrigger asChild>{icon}</TooltipTrigger>
        <TooltipContent className="max-w-[360px] whitespace-normal">
          {labels[action.type]}
          {reason && <div className="text-muted-foreground">{reason}</div>}
          {action.reason && action.policyName && (
            <div className="text-muted-foreground">{action.policyName}</div>
          )}
        </TooltipContent>
      </Tooltip>
      <span className="truncate text-sm text-foreground">{sentence}</span>
    </div>
  );
}

/** Expanded-row content: the item's planning actions as child lines. Each is
 *  two columns — the action as a sentence on the left, and its assignee and
 *  controls pushed to the right. */
export function PlanningActionLines({
  actions,
  todayIso,
  onOrder,
  ...handlers
}: PlanningActionLinesProps) {
  const sorted = useMemo(() => sortPlanningActions(actions), [actions]);

  if (sorted.length === 0) return null;

  return (
    <ul className="flex w-full flex-col divide-y divide-border py-1 pl-[52px] pr-2">
      {sorted.map((action) => {
        const isDismissed = action.status === "Dismissed";
        // A Decrease / Defer / Cancel is never late (see isPlanningActionLate)
        const isLate = isPlanningActionLate(action, todayIso);

        return (
          <li
            key={action.id}
            className={cn(
              "flex min-h-11 items-center justify-between gap-4 py-1",
              isDismissed && "opacity-60"
            )}
          >
            <PlanningActionSentence action={action} isLate={isLate} />
            <div className="flex shrink-0 items-center gap-2">
              <Assignee
                id={action.id}
                table="planningAction"
                size="sm"
                value={action.assignee ?? ""}
                isReadOnly={!handlers.canUpdate || handlers.isBusy}
                className="max-w-[200px] truncate"
                onAssign={(assignee) =>
                  handlers.onAssign([action.id], assignee)
                }
              />
              <PlanningActionRowActions
                action={action}
                {...handlers}
                onOrder={onOrder}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
