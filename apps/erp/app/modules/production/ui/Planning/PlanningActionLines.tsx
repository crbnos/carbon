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
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Table as TableBase,
  Tbody,
  Td,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr
} from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { BsExclamationSquareFill } from "react-icons/bs";
import {
  LuBan,
  LuChevronsDown,
  LuChevronsUp,
  LuEllipsisVertical,
  LuEyeOff,
  LuHammer,
  LuMinus,
  LuPlus,
  LuRotateCcw,
  LuShoppingCart,
  LuUserCheck,
  LuX
} from "react-icons/lu";
import { Link } from "react-router";
import { DateTime, EmployeeAvatar, Hyperlink } from "~/components";
import { useQuantityFormatter } from "~/hooks";
import type { PlanningAction } from "~/modules/production";
import type { planningActionType } from "~/modules/production/production.models";
import PurchasingStatus from "~/modules/purchasing/ui/PurchaseOrder/PurchasingStatus";
import { path } from "~/utils/path";
import JobStatus from "../Jobs/JobStatus";

// The MRP action worklist (spec §P1.7) rendered INSIDE the planning grid: one
// persisted planningAction per line, shown in the expanded row of the item it
// belongs to. The grid row is the item; the action is the dated decision.

export type PlanningActionType = (typeof planningActionType)[number];

const NEW_SUPPLY_TYPES: ReadonlySet<string> = new Set(["Order", "Make"]);

/** Order/Make rows are fulfilled through the grid's Order button + drawer. */
export function isNewSupplyAction(action: PlanningAction) {
  return NEW_SUPPLY_TYPES.has(action.type);
}

/** One-click Apply: an Open change action whose target is still uncommitted. */
export function isApplyablePlanningAction(action: PlanningAction) {
  return (
    action.status === "Open" &&
    !action.requiresManualAction &&
    !isNewSupplyAction(action)
  );
}

const TYPE_ICONS: Record<PlanningActionType, ReactNode> = {
  Order: <LuShoppingCart />,
  Make: <LuHammer />,
  Expedite: <LuChevronsUp />,
  Defer: <LuChevronsDown />,
  Increase: <LuPlus />,
  Decrease: <LuMinus />,
  Cancel: <LuBan />
};

const TYPE_ORDER: PlanningActionType[] = [
  "Expedite",
  "Cancel",
  "Decrease",
  "Increase",
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
      Cancel: t`Cancel`
    }),
    [t]
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
    <Badge variant="secondary" className="gap-1 shrink-0 whitespace-nowrap">
      <span className="inline-flex shrink-0 [&>svg]:size-3">
        {TYPE_ICONS[type]}
      </span>
      <span>{labels[type]}</span>
      {hasCount && (
        <span className="tabular-nums text-muted-foreground">·{count}</span>
      )}
    </Badge>
  );
}

/** Static filter options for the Actions column: one per type the worklist
 *  can hold, rendered as the same badge the cell shows. Only types that
 *  belong to this grid's kind are offered. */
export function usePlanningActionTypeOptions(kind: "Buy" | "Make") {
  return useMemo(() => {
    const types = TYPE_ORDER.filter((type) =>
      kind === "Buy" ? type !== "Make" : type !== "Order"
    );
    return types.map((type) => ({
      value: type,
      label: <PlanningActionTypeBadge type={type} />
    }));
  }, [kind]);
}

function AsapIcon() {
  const { t } = useLingui();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" className="inline-flex shrink-0" aria-label={t`ASAP`}>
          <BsExclamationSquareFill className="text-red-500 size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <Trans>ASAP</Trans>
      </TooltipContent>
    </Tooltip>
  );
}

/** The grid's Actions cell: one ICON chip per open action type (with a count
 *  when the item has several; the name is in its tooltip), the ASAP flag when
 *  any is urgent, and a muted chip for dismissed rows so they stay reachable
 *  from the expanded row. Icons only, so the cell is always ONE line — a
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
  const isASAP = open.some((a) => a.isASAP);
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
      {isASAP && <AsapIcon />}
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

function reviewPathFor(action: PlanningAction) {
  if (action.purchaseOrderId)
    return path.to.purchaseOrder(action.purchaseOrderId);
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
  onOrder
}: PlanningActionHandlers & {
  action: PlanningAction;
  /** Opens the order drawer for a new-supply action. A host that lists change
   *  actions only (the order drawer itself) omits it. */
  onOrder?: () => void;
}) {
  const { t } = useLingui();
  const isDismissed = action.status === "Dismissed";
  const reviewPath = action.requiresManualAction ? reviewPathFor(action) : null;
  const isMine = action.assignee === currentUserId;

  return (
    <div className="flex items-center justify-end gap-1">
      {isDismissed ? (
        <span className="text-xs text-muted-foreground">
          <Trans>Dismissed</Trans>
        </span>
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

type PlanningActionLinesProps = {
  actions: PlanningAction[];
  currentUserId: string;
  canUpdate: boolean;
  isBusy: boolean;
  onApply: (ids: string[]) => void;
  onDismiss: (ids: string[]) => void;
  onReopen: (ids: string[]) => void;
  onAssignToMe: (ids: string[]) => void;
  /** Opens the grid's order drawer for this item (Order / Make rows). */
  onOrder: () => void;
};

/** Expanded-row content: the item's planning actions as child lines, in the
 *  same recipe as Change Notices → affected items and Batches → members. */
export function PlanningActionLines({
  actions,
  currentUserId,
  canUpdate,
  isBusy,
  onApply,
  onDismiss,
  onReopen,
  onAssignToMe,
  onOrder
}: PlanningActionLinesProps) {
  const formatQuantity = useQuantityFormatter();
  const todayIso = today(getLocalTimeZone()).toString();

  const sorted = useMemo(() => sortPlanningActions(actions), [actions]);

  if (sorted.length === 0) return null;

  // The Table pins this block to the grid's visible width (`sticky left-0`),
  // so a wide grid does not push the lines off-screen. There is no header
  // row — the grid's own header already names the item, and a second header
  // per expanded row read as clutter — so `table-fixed` takes its column
  // widths from the `colgroup`, keeping cells aligned between rows; the widths
  // are sized to their widest content (incl. the primitives' px-6). The
  // reason is a tooltip on an info icon beside the
  // badge — a sentence per row is a column no width comfortably fits. The
  // grid lives in a half-width resizable pane, so the block is a container:
  // below @4xl the assignee is avatar-only, and narrower than the columns'
  // sum the block scrolls on its own rather than squeezing any column.
  //
  // `@container` is inline-size containment: the block has NO intrinsic width,
  // so it must be stretched by its parent. In a shrink-to-fit parent (a flex
  // column with `items-start`, e.g. VStack) it collapses to zero and the rows
  // vanish — hence the explicit `w-full`.
  const cell = "group-hover:bg-inherit";

  return (
    <div className="w-full pl-[52px] pr-2 py-1 @container">
      <div className="overflow-x-auto">
        <TableBase full className="table-fixed">
          <colgroup>
            <col className="w-[200px]" />
            {/* the status icon, the order id and `Hyperlink`'s hover "Open"
                button */}
            <col className="w-[264px]" />
            <col className="w-[120px]" />
            <col className="w-[170px]" />
            <col />
            <col className="w-[180px]" />
          </colgroup>
          <Tbody>
            {sorted.map((action) => {
              const isDismissed = action.status === "Dismissed";
              const isLate = !isDismissed && action.suggestedDate < todayIso;
              const documentId =
                action.purchaseOrderReadableId ?? action.jobReadableId ?? null;
              const documentPath = reviewPathFor(action);

              return (
                <Tr
                  key={action.id}
                  className={cn(isDismissed && "text-muted-foreground")}
                >
                  <Td className={cn(cell, "whitespace-nowrap")}>
                    <PlanningActionTypeWithReason action={action} />
                  </Td>
                  <Td className={cn(cell, "overflow-hidden whitespace-nowrap")}>
                    {documentId && documentPath ? (
                      <HStack spacing={2} className="flex-nowrap">
                        {/* why this row is Review or Apply, without a
                            status column: the icon, its name on hover */}
                        <PurchasingStatus
                          iconOnly
                          status={action.purchaseOrderStatus}
                        />
                        <JobStatus iconOnly status={action.jobStatus} />
                        <Hyperlink to={documentPath}>{documentId}</Hyperlink>
                      </HStack>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        <Trans>New supply</Trans>
                      </span>
                    )}
                  </Td>
                  <Td className={cn(cell, "tabular-nums whitespace-nowrap")}>
                    {formatQuantity(action.suggestedQuantity)}
                  </Td>
                  <Td className={cn(cell, "whitespace-nowrap")}>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5",
                        isLate && "text-red-500"
                      )}
                    >
                      <DateTime value={action.suggestedDate} variant="date" />
                      {action.isASAP && !isDismissed && <AsapIcon />}
                    </span>
                  </Td>
                  <Td className={cn(cell, "overflow-hidden whitespace-nowrap")}>
                    {action.assignee ? (
                      <>
                        <div className="@4xl:hidden">
                          <EmployeeAvatar
                            employeeId={action.assignee}
                            size="xs"
                            withName={false}
                          />
                        </div>
                        <div className="hidden @4xl:block truncate">
                          <EmployeeAvatar
                            employeeId={action.assignee}
                            size="xs"
                          />
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        <span className="@4xl:hidden">—</span>
                        <span className="hidden @4xl:inline">
                          <Trans>Unassigned</Trans>
                        </span>
                      </span>
                    )}
                  </Td>
                  <Td className={cell}>
                    <PlanningActionRowActions
                      action={action}
                      currentUserId={currentUserId}
                      canUpdate={canUpdate}
                      isBusy={isBusy}
                      onApply={onApply}
                      onDismiss={onDismiss}
                      onReopen={onReopen}
                      onAssignToMe={onAssignToMe}
                      onOrder={onOrder}
                    />
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </TableBase>
      </div>
    </div>
  );
}
