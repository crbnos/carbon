// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { Check, Trash2 } from "lucide-react-native";
import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { Card } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import {
  closedDurations,
  type OpenEvents,
  WORK_TYPES,
  type WorkType
} from "./logic";
import {
  DeadlineIcon,
  isOverdue,
  operationFacts,
  statusColorFor
} from "./OperationHeader";
import { formatElapsed, useTimer } from "./useTimer";

/**
 * A port of web MES's Details tab — the `details` `TabsContent` of
 * `apps/mes/app/components/JobOperation/JobOperation.tsx` — in that screen's
 * own order:
 *
 *  1. the item, with the time each finished piece has taken beside it;
 *  2. the three stat cards: Completed, Scrapped, Due Date;
 *  3. the labelled meters web pins below the workspace as its status strip.
 *
 * Web lays the stat cards out one per column at phone width and only widens to
 * two and three from `md` and `xl`; stacked full-width cards here ARE that
 * narrow layout, not a simplification of it.
 *
 * The meters are web's `Times` strip, which it keeps visible under every tab
 * because a desktop has the room. There is no room for a permanent strip on a
 * phone, so they sit at the foot of this tab instead — the one place in this
 * port where web's layout could not follow.
 *
 * Durations read `hh:mm:ss` rather than web's "1 hr 20 min": that wording
 * comes from `humanize-duration` via `@carbon/utils/duration`, which is not a
 * dependency of this app (and adding one is an Ask First), and `formatElapsed`
 * is already the duration this app speaks everywhere else.
 */

/** Fixed-width digits, so a ticking timer does not jitter its own layout. */
const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** A share of the track, clamped — never a bar longer than its own meter. */
function share(value: number, max: number) {
  if (max <= 0) return 0;
  return Math.min(Math.max(value / max, 0), 1);
}

type Segment = { key: string; share: number; className: string };

/**
 * One of web's `BarProgress` meters: the label left, the value right, the
 * track under both. Web draws its track as a row of 2px ticks measured against
 * the container's width; this is one continuous fill, which needs no
 * measurement — the shape `Progress` in the same package already uses — and so
 * cannot render an empty bar while a native layout pass settles.
 */
function Meter({
  label,
  value,
  segments
}: {
  label: string;
  value: string;
  /** Rendered in order. An empty list leaves the track bare, as web does for an operation with no plan. */
  segments: Segment[];
}) {
  return (
    <View className="gap-1">
      <View className="flex-row items-baseline justify-between gap-2">
        <Text className="text-sm font-medium text-foreground">{label}</Text>
        <Text className="shrink text-sm text-muted-foreground" style={TABULAR}>
          {value}
        </Text>
      </View>
      <View className="h-3 w-full flex-row overflow-hidden rounded-full bg-muted">
        {segments.map((segment) =>
          segment.share > 0 ? (
            <View
              key={segment.key}
              className={segment.className}
              style={{ width: `${segment.share * 100}%` }}
            />
          ) : null
        )}
      </View>
    </View>
  );
}

/** Web's stat card: a muted title with its icon, then the number. */
function StatCard({
  title,
  icon,
  value,
  overdue = false
}: {
  title: string;
  icon: ReactNode;
  value: string;
  overdue?: boolean;
}) {
  return (
    <Card className="gap-2">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="text-sm font-medium text-muted-foreground">
          {title}
        </Text>
        {icon}
      </View>
      <Text
        className={`text-3xl font-semibold ${
          overdue ? "text-red-600 dark:text-red-400" : "text-foreground"
        }`}
        style={TABULAR}
        numberOfLines={1}
      >
        {value}
      </Text>
    </Card>
  );
}

export function DetailsTab({
  detail,
  openEvents
}: {
  detail: OperationDetail;
  openEvents: OpenEvents;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  const { operation, job, quantities } = detail;
  const facts = operationFacts(operation);

  // One timer per work type, unconditionally — a hook cannot live in the
  // meters' loop, and the per-piece rate needs all three summed anyway.
  const liveSetup = useTimer(openEvents.Setup);
  const liveLabor = useTimer(openEvents.Labor);
  const liveMachine = useTimer(openEvents.Machine);
  const closed = closedDurations(detail.events);

  const planned: Record<WorkType, number> = {
    Setup: operation.setupDuration ?? 0,
    Labor: operation.laborDuration ?? 0,
    Machine: operation.machineDuration ?? 0
  };
  const elapsed: Record<WorkType, number> = {
    Setup: closed.Setup + (liveSetup ?? 0),
    Labor: closed.Labor + (liveLabor ?? 0),
    Machine: closed.Machine + (liveMachine ?? 0)
  };

  const quantity = (value: number) => formatQuantity(value, locale);
  const complete = operation.quantityComplete ?? 0;
  const target = facts.targetQuantity ?? 0;
  const scrapped = operation.quantityScrapped ?? quantities.scrap;
  const reworked = operation.quantityReworked ?? quantities.rework;

  const due = operation.operationDueDate ?? job.dueDate ?? null;
  const overdue = isOverdue(due, facts.deadlineType);
  const dueLabel =
    facts.deadlineType === "ASAP" || facts.deadlineType === "No Deadline"
      ? facts.deadlineType
      : due
        ? formatDate(due.slice(0, 10), undefined, locale)
        : "–";

  // Web shows every type it plans time for; this keeps a type that has banked
  // or running time with no plan as well, since hiding it would hide hours an
  // operator has already worked.
  const meterTypes = WORK_TYPES.filter(
    (type) => planned[type] > 0 || elapsed[type] > 0
  );
  const labels: Record<WorkType, string> = {
    Setup: t`Setup`,
    Labor: t`Labor`,
    Machine: t`Machine`
  };

  // How long each finished piece has taken. Web always renders it, dividing by
  // at least one — which reads as "this piece took two hours" on an operation
  // that has finished nothing, so here it waits for a first completed piece.
  const perPiece =
    complete > 0
      ? (elapsed.Setup + elapsed.Labor + elapsed.Machine) / complete
      : null;

  return (
    <ScrollView
      className="flex-1"
      contentContainerClassName="gap-4 px-4 pb-8 pt-2"
    >
      {/* Web's details header: the item on the left, its pace on the right. */}
      <View className="flex-row items-start justify-between gap-4">
        <View className="min-w-0 flex-1">
          <Text
            className="text-lg font-semibold text-foreground"
            numberOfLines={2}
          >
            {operation.description ?? operation.itemDescription ?? t`Operation`}
          </Text>
          {operation.itemReadableId ? (
            <Text className="text-sm text-muted-foreground" numberOfLines={1}>
              {operation.itemReadableId}
            </Text>
          ) : null}
        </View>
        {perPiece === null ? null : (
          <View className="items-end">
            <Text
              className="text-2xl font-semibold text-foreground"
              style={TABULAR}
            >
              {formatElapsed(perPiece)}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {facts.unitOfMeasure
                ? t`per ${facts.unitOfMeasure}`
                : t`per unit`}
            </Text>
          </View>
        )}
      </View>

      <View className="h-px bg-border" />

      <StatCard
        title={t`Completed`}
        icon={
          <Check size={16} color={statusColorFor("green", colors.foreground)} />
        }
        value={t`${quantity(complete)} of ${quantity(target)}`}
      />
      <StatCard
        title={t`Scrapped`}
        icon={<Trash2 size={16} color={colors.mutedForeground} />}
        value={quantity(scrapped)}
      />
      <StatCard
        title={t`Due Date`}
        icon={
          <DeadlineIcon
            deadlineType={facts.deadlineType}
            overdue={overdue}
            color={colors.mutedForeground}
          />
        }
        value={dueLabel}
        overdue={overdue}
      />

      <Card className="gap-4">
        {meterTypes.map((type) => {
          // A batch with no planned time anywhere carries a 1ms placeholder
          // plan so ratios never divide by zero. That is not a plan: show the
          // elapsed time alone over an empty track, as web does.
          const hasPlan = planned[type] > 1;
          const over = elapsed[type] > planned[type];
          return (
            <Meter
              key={type}
              label={labels[type]}
              value={
                hasPlan
                  ? `${formatElapsed(elapsed[type])} / ${formatElapsed(
                      planned[type]
                    )}`
                  : formatElapsed(elapsed[type])
              }
              segments={
                hasPlan
                  ? [
                      {
                        key: "elapsed",
                        share: share(elapsed[type], planned[type]),
                        className: over ? "bg-red-500" : "bg-emerald-500"
                      }
                    ]
                  : []
              }
            />
          );
        })}
        <Meter
          label={t`Quantity`}
          value={`${quantity(complete)} / ${quantity(target)}`}
          segments={[
            {
              key: "complete",
              share: share(complete, target || 1),
              className: "bg-emerald-500"
            },
            {
              key: "reworked",
              share: share(reworked, target || 1),
              className: "bg-yellow-500"
            },
            {
              key: "scrapped",
              share: share(scrapped, target || 1),
              className: "bg-red-500"
            }
          ]}
        />
      </Card>
    </ScrollView>
  );
}
