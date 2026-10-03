// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationDetail } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import {
  ClipboardCheck,
  Factory,
  OctagonAlert,
  SquareUser,
  Timer,
  TriangleAlert
} from "lucide-react-native";
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { BigNumber } from "~/components/BigNumber";
import { useThemeColors } from "~/components/useThemeColor";
import { formatDuration } from "./duration";
import { OVERDUE_COLOR, statusColorFor, statusIcon } from "./statusVocabulary";

/**
 * A port of web MES's operation header — its `header` and the `context` bar
 * under it (`apps/mes/app/components/JobOperation/JobOperation.tsx`) — not a
 * new design.
 *
 * The identity block is the one the list card already ports
 * (`OperationCard.tsx`): the item id above its description, so tapping a card
 * enlarges what was on it rather than replacing it with something else. Under
 * that comes the quantity progress, then web's context bar: ONE icon-and-text
 * row per fact, in the order web lists them — job, customer, operation
 * description, status, planned duration, deadline — with the same icon
 * vocabulary the card uses.
 *
 * What is NOT copied is the sizing: web's context bar assumes a mouse. Nothing
 * here is below `text-sm`, and the facts WRAP rather than scrolling sideways
 * (web's own bar is `flex-wrap` below `lg`, so this is its narrow layout).
 *
 * Dates go through `formatDate`, which parses the stored `YYYY-MM-DD` as a
 * calendar date rather than an instant. A `new Date(…)` here would render the
 * day BEFORE for any operator west of UTC — the bug
 * `.claude/rules/date-handling.md` was written about, and on a shop floor a due
 * date that is a day early is a job expedited for nothing.
 */

/**
 * Fields `get_job_operation_by_id` returns that the wire contract does not
 * declare. `operationDetail.operation` is `.passthrough()`, so they survive
 * parsing untouched; reading them here rather than widening
 * `@carbon/mes-core` leaves the additive-only `/api/v1` shape alone. Every one
 * is optional, so a server that stops sending one renders nothing instead of
 * crashing the screen an operator is standing in front of.
 */
export type OperationFacts = {
  /** The operation's own status. The contract's `status` is only set on the LIST payload. */
  operationStatus: string | null;
  /** A paused JOB outranks the operation's status, exactly as web's header decides it. */
  jobStatus: string | null;
  deadlineType: string | null;
  /** What web counts "complete of" — `operationQuantity` is the fallback. */
  targetQuantity: number | null;
  unitOfMeasure: string | null;
  isRework: boolean;
};

function text(operation: OperationDetail["operation"], key: string) {
  const value = (operation as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function count(operation: OperationDetail["operation"], key: string) {
  const value = (operation as unknown as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function operationFacts(
  operation: OperationDetail["operation"]
): OperationFacts {
  return {
    operationStatus:
      text(operation, "operationStatus") ?? operation.status ?? null,
    jobStatus: text(operation, "jobStatus"),
    deadlineType: text(operation, "jobDeadlineType"),
    targetQuantity:
      count(operation, "targetQuantity") ?? operation.operationQuantity ?? null,
    unitOfMeasure: text(operation, "itemUnitOfMeasure"),
    isRework: text(operation, "reworkId") !== null
  };
}

/** The status web's header shows: a paused job overrides the operation's own. */
export function displayStatus(facts: OperationFacts) {
  return facts.jobStatus === "Paused" ? "Paused" : facts.operationStatus;
}

/**
 * Three ascending bars — the picture `HighPriorityIcon`,
 * `MediumPriorityIcon` and `LowPriorityIcon` draw on the web, where they are
 * three `<rect>`s in a 16px box with the unfilled ones at `fillOpacity 0.4`.
 * Drawn from `View`s rather than imported: it is the same image with no SVG
 * dependency, and no third-party component that could silently ignore a
 * className.
 */
function PriorityBars({ filled, color }: { filled: 1 | 2 | 3; color: string }) {
  return (
    <View className="flex-row items-end gap-0.5">
      {[7, 11, 15].map((height, index) => (
        <View
          key={height}
          style={{
            width: 3,
            height,
            borderRadius: 1,
            backgroundColor: color,
            opacity: index < filled ? 1 : 0.4
          }}
        />
      ))}
    </View>
  );
}

/**
 * `DeadlineIcon` from `apps/mes/app/components/Icons.tsx`: ASAP is a filled
 * alert, a Hard Deadline is three solid bars, a Soft Deadline fades the last
 * one, No Deadline fades two — and the bars turn red when the work is overdue.
 * An unknown type renders nothing, as the web's `default` branch does.
 *
 * ASAP is lucide's `OctagonAlert` because the web's glyph
 * (`BsExclamationSquareFill`, a filled square with a knockout "!") has no
 * `lucide-react-native` equivalent; it reads the same — "drop everything" —
 * and is not the `TriangleAlert` this screen already uses for a blocked work
 * centre.
 */
export function DeadlineIcon({
  deadlineType,
  overdue,
  color
}: {
  deadlineType: string | null;
  overdue: boolean;
  /** The resting colour. Overdue always wins, as on the web. */
  color: string;
}) {
  const tone = overdue ? OVERDUE_COLOR : color;
  switch (deadlineType) {
    case "ASAP":
      return <OctagonAlert size={16} color={OVERDUE_COLOR} />;
    case "Hard Deadline":
      return <PriorityBars filled={3} color={tone} />;
    case "Soft Deadline":
      return <PriorityBars filled={2} color={tone} />;
    case "No Deadline":
      return <PriorityBars filled={1} color={color} />;
    default:
      return null;
  }
}

/**
 * Overdue is decided on CALENDAR DAYS, not instants: the due date is stored as
 * `YYYY-MM-DD`, and `new Date("2026-10-03") < new Date()` — which is how the
 * web asks — is true from UTC midnight, so a job due today reads overdue on a
 * morning shift in Chicago. Comparing the two calendar days in the device's own
 * zone makes "due today" not yet late.
 *
 * `No Deadline` is never overdue, the rule `OperationCard`'s web original
 * (`OperationsList.tsx`) applies.
 */
export function isOverdue(
  dueDate: string | null | undefined,
  deadlineType: string | null
) {
  if (!dueDate || deadlineType === "No Deadline") return false;
  try {
    return (
      parseDate(dueDate.slice(0, 10)).compare(today(getLocalTimeZone())) < 0
    );
  } catch {
    return false;
  }
}

/** One fact of web's context bar: an icon, then a line of text. */
function Fact({
  icon,
  overdue = false,
  children
}: {
  icon: ReactNode;
  overdue?: boolean;
  children: ReactNode;
}) {
  return (
    <View className="max-w-full flex-row items-center gap-2">
      {icon}
      <Text
        className={`shrink text-sm ${
          overdue ? "text-red-600 dark:text-red-400" : "text-foreground"
        }`}
        numberOfLines={1}
      >
        {children}
      </Text>
    </View>
  );
}

export function OperationHeader({
  detail,
  blockedReason
}: {
  detail: OperationDetail;
  /** The work center is blocked, or the operation is part of a batch. */
  blockedReason?: string;
}) {
  const { t, i18n } = useLingui();
  const colors = useThemeColors();
  const { operation, job } = detail;
  const locale = i18n.locale || "en";
  const facts = operationFacts(operation);

  const due = operation.operationDueDate ?? job.dueDate ?? null;
  const overdue = isOverdue(due, facts.deadlineType);
  const status = displayStatus(facts);
  const { Icon: StatusIcon, tone } = statusIcon(status);

  // The planned total web's context bar shows: setup plus whichever of labour
  // and machine time is longer, since those two run together. The same sum the
  // operations list builds for a card (`screens.server.ts`).
  const planned =
    (operation.setupDuration ?? 0) +
    Math.max(operation.laborDuration ?? 0, operation.machineDuration ?? 0);

  // With no date, the deadline TYPE is still worth reading — the board card
  // says "Hard Deadline", and a lone dash here read as missing data.
  const dueLabel =
    facts.deadlineType === "ASAP" || facts.deadlineType === "No Deadline"
      ? facts.deadlineType
      : due
        ? t`Due ${formatDate(due.slice(0, 10), undefined, locale)}`
        : (facts.deadlineType ?? "–");
  // A plan, not a clock: "28m", as the board card writes it. `hh:mm:ss` here
  // read as a timer that was running.
  const plannedLabel = formatDuration(planned);

  return (
    <View className="gap-3 py-4">
      {/* Identity, as the list card shows it: the id above the description. */}
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          {operation.itemReadableId ? (
            <Text className="text-sm text-muted-foreground" numberOfLines={1}>
              {operation.itemReadableId}
            </Text>
          ) : null}
          <Text
            className="text-xl font-semibold leading-tight text-foreground"
            numberOfLines={2}
          >
            {operation.itemDescription ??
              operation.itemReadableId ??
              t`Operation`}
          </Text>
        </View>
        {facts.isRework ? (
          // Web badges a rework operation beside its heading. Same classes the
          // app's own `StatusBadge` uses for red, so the two read as one set.
          <View className="rounded-full border border-red-500/40 bg-red-500/15 px-2 py-0.5">
            <Text className="text-sm text-red-600 dark:text-red-400">
              {t`Rework`}
            </Text>
          </View>
        ) : null}
      </View>

      <BigNumber
        value={operation.quantityComplete ?? 0}
        of={facts.targetQuantity}
      />

      {/* Web's context bar. It wraps here, as web's own does below `lg`.
          One `gap-3` rather than web's `gap-x-4 gap-y-1`: the asymmetric
          pair is the app's first use of `gap-x`/`gap-y`, and an unsupported
          class is DROPPED by Uniwind in silence rather than erroring. */}
      <View className="flex-row flex-wrap items-center gap-3">
        {/* The job id is NOT repeated here: it is this screen's own title
            (`OperationDetailView` titles the screen with it), and on a phone
            this bar wraps, so every duplicated fact costs a row of the work
            the operator came to read. Web can afford it — its header is one
            line beside a breadcrumb that does not carry the job. */}
        {/* The NAME, as web's header shows. `customerId` is an opaque
            `cust_…` key — it filled a whole row of this bar with noise. A job
            with no customer name shows nothing rather than the key. */}
        {job.customer?.name ? (
          <Fact icon={<SquareUser size={16} color={colors.mutedForeground} />}>
            {job.customer.name}
          </Fact>
        ) : null}

        {operation.description ? (
          <Fact
            icon={<ClipboardCheck size={16} color={colors.mutedForeground} />}
          >
            {operation.description}
          </Fact>
        ) : null}

        {status ? (
          <Fact
            icon={
              <StatusIcon
                size={16}
                color={statusColorFor(tone, colors.foreground)}
              />
            }
          >
            {status}
          </Fact>
        ) : null}

        {plannedLabel ? (
          <Fact icon={<Timer size={16} color={colors.mutedForeground} />}>
            {plannedLabel}
          </Fact>
        ) : null}

        {facts.deadlineType ? (
          <Fact
            overdue={overdue}
            icon={
              <DeadlineIcon
                deadlineType={facts.deadlineType}
                overdue={overdue}
                color={colors.mutedForeground}
              />
            }
          >
            {dueLabel}
          </Fact>
        ) : null}

        {/* Not on web's bar — that screen is reached from one work centre's
            column. Here an operator carries the tablet between machines. */}
        {detail.workCenter?.data?.name ? (
          <Fact icon={<Factory size={16} color={colors.mutedForeground} />}>
            {detail.workCenter.data.name}
          </Fact>
        ) : null}
      </View>

      {blockedReason ? (
        <View className="flex-row items-center gap-2 rounded-lg border border-border bg-muted p-3">
          <TriangleAlert size={18} color={colors.destructive} />
          <Text className="flex-1 text-sm text-muted-foreground">
            {blockedReason}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Re-exported so the screens that already import these from the header keep
// working; `statusVocabulary.ts` is where they are defined.
export { OVERDUE_COLOR, statusColorFor, statusIcon };
