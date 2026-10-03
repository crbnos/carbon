// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard as OperationCardData } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { useLingui } from "@lingui/react/macro";
import {
  CalendarDays,
  CircleCheck,
  CirclePlay,
  ClipboardCheck,
  ReceiptText,
  SquareUser,
  Timer,
  Trash2,
  TriangleAlert
} from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Card } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { formatDuration } from "./duration";
import { DeadlineIcon, isOverdue } from "./OperationHeader";
import { OVERDUE_COLOR, statusColorFor, statusIcon } from "./statusVocabulary";

/**
 * A port of web MES's own operation card
 * (`apps/mes/app/components/OperationsList.tsx`), not a new design.
 *
 * An operator moves between a browser and a tablet during one shift, so the
 * two have to read as the same product: the item id above its description, the
 * target quantity top-right, then one icon-and-text row per fact in the same
 * order the web lists them, and a card border that changes with status.
 *
 * What is NOT copied is the sizing. Web rows are `text-sm` with a mouse; here
 * the whole card is the press target and nothing is smaller than `text-sm`
 * with a 20pt icon, because this is read standing up, often gloved.
 *
 * The web card it is ported from is `Kanban/components/ItemCard.tsx`, and its
 * rows are followed in order: job, operation, status, planned duration,
 * deadline, due date, sales order, customer, scrapped.
 */

/**
 * What the board sends for a card beyond the fields the contract names.
 *
 * `operationCard` is `.passthrough()`, so these survive parsing; they are read
 * defensively here rather than trusted, because nothing has validated them. A
 * field that stops arriving makes its row disappear, not the screen crash.
 */
function extras(operation: OperationCardData) {
  const raw = operation as unknown as Record<string, unknown>;
  const text = (key: string) =>
    typeof raw[key] === "string" && raw[key] !== ""
      ? (raw[key] as string)
      : null;
  const number = (key: string) =>
    typeof raw[key] === "number" && Number.isFinite(raw[key])
      ? (raw[key] as number)
      : null;
  return {
    /** The scheduler could not fit this operation before its job is due. */
    hasConflict: raw.hasConflict === true,
    conflictReason: text("conflictReason"),
    /** Planned time for the whole operation, in milliseconds. */
    duration: number("duration"),
    customerId: text("customerId"),
    isRework: text("reworkId") !== null
  };
}

/** The web's `cardVariants`: the border carries the status too, not just a row. */
function cardTone(status: string | null | undefined) {
  switch (status) {
    case "In Progress":
      return "border-emerald-600/40";
    case "Canceled":
    case "Cancelled":
      return "border-red-500 opacity-50";
    case "Waiting":
      return "opacity-50";
    default:
      return "border-border";
  }
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <View className="flex-row items-center gap-2">
      {icon}
      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

export function OperationCard({
  operation,
  onPress,
  selected = false,
  customerName
}: {
  operation: OperationCardData;
  onPress: () => void;
  /** Marked in the tablet's two-pane layout: the card IS the current screen. */
  selected?: boolean;
  /** Resolved by the board, which is sent the customers once for all cards. */
  customerName?: string | null;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();

  const { Icon: StatusIcon, tone } = statusIcon(operation.status);
  const target = operation.targetQuantity ?? operation.quantity ?? 0;
  const due = operation.dueDate ? String(operation.dueDate).slice(0, 10) : null;
  const more = extras(operation);
  const deadlineType = operation.deadlineType ?? null;
  const overdue = isOverdue(due, deadlineType);
  const planned = formatDuration(more.duration);
  const completed = operation.quantityCompleted ?? 0;
  const reworked = operation.quantityReworked ?? 0;
  const scrapped = operation.quantityScrapped ?? 0;
  // Web's deadline row: the TYPE when the type is the whole message, the date
  // otherwise. Never both rows for one fact — the calendar row below is only
  // drawn when this one did not already say the date.
  const deadlineSaysDate =
    deadlineType !== null &&
    deadlineType !== "ASAP" &&
    deadlineType !== "No Deadline" &&
    due !== null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={t`Open operation ${
        operation.itemReadableId ?? operation.jobReadableId ?? ""
      }`}
    >
      <Card
        // A conflict outranks the status border, exactly as web orders its
        // classes: an operation that cannot finish before its job is due is
        // the first thing a supervisor needs to see on this board.
        className={`gap-3 active:opacity-80 ${cardTone(operation.status)} ${
          more.hasConflict ? "border-2 border-red-500" : ""
        } ${selected ? "border-ring bg-accent" : ""}`}
      >
        {/* Header: id over description, target quantity to the right. */}
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            {operation.itemReadableId ? (
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {operation.itemReadableId}
              </Text>
            ) : null}
            <Text
              className="text-base font-semibold leading-tight text-foreground"
              numberOfLines={2}
            >
              {operation.itemDescription ?? operation.itemReadableId ?? ""}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            {more.hasConflict ? (
              <TriangleAlert
                size={18}
                color={OVERDUE_COLOR}
                accessibilityLabel={
                  more.conflictReason ?? t`Scheduling conflict`
                }
              />
            ) : null}
            <Text className="text-xl font-semibold text-foreground">
              {target}
            </Text>
          </View>
        </View>

        {/* Web's quantity meter: completed, reworked, scrapped against the
            target. Drawn only once there is something in it — an empty track
            on every untouched card is forty grey lines on a board. */}
        {target > 0 && completed + reworked + scrapped > 0 ? (
          <View className="flex-row items-center gap-2">
            <View className="h-2 flex-1 flex-row overflow-hidden rounded-full bg-muted">
              {[
                { key: "done", value: completed, tone: "bg-emerald-500" },
                { key: "rework", value: reworked, tone: "bg-yellow-500" },
                { key: "scrap", value: scrapped, tone: "bg-red-500" }
              ].map((part) =>
                part.value > 0 ? (
                  <View
                    key={part.key}
                    className={part.tone}
                    style={{
                      width: `${Math.min(part.value / target, 1) * 100}%`
                    }}
                  />
                ) : null
              )}
            </View>
            <CircleCheck size={16} color={colors.mutedForeground} />
          </View>
        ) : null}

        {/* One row per fact, in the web's order. */}
        <View className="gap-2">
          {operation.jobReadableId ? (
            <View className="flex-row items-center gap-2">
              <CirclePlay size={16} color={colors.mutedForeground} />
              <Text
                className="shrink text-sm text-foreground"
                numberOfLines={1}
              >
                {operation.jobReadableId}
              </Text>
              {more.isRework ? (
                <View className="rounded-full border border-red-500/40 bg-red-500/15 px-2">
                  <Text className="text-xs text-red-600 dark:text-red-400">
                    {t`Rework`}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {operation.description ? (
            <Row
              icon={<ClipboardCheck size={16} color={colors.mutedForeground} />}
            >
              {operation.description}
            </Row>
          ) : null}

          {operation.status ? (
            <Row
              icon={
                <StatusIcon
                  size={16}
                  color={statusColorFor(tone, colors.foreground)}
                />
              }
            >
              {operation.status}
            </Row>
          ) : null}

          {operation.batchReadableId ? (
            <Row icon={<Timer size={16} color={colors.mutedForeground} />}>
              {operation.batchSize
                ? t`Batch of ${operation.batchSize}`
                : operation.batchReadableId}
            </Row>
          ) : null}

          {planned ? (
            <Row icon={<Timer size={16} color={colors.mutedForeground} />}>
              {planned}
            </Row>
          ) : null}

          {deadlineType ? (
            <View className="flex-row items-center gap-2">
              {/* Fixed width so the text lines up with the icon rows above,
                  whichever of the three bar counts is drawn. */}
              <View className="w-4 items-center">
                <DeadlineIcon
                  deadlineType={deadlineType}
                  overdue={overdue}
                  color={colors.mutedForeground}
                />
              </View>
              <Text
                className={`flex-1 text-sm ${
                  overdue ? "text-red-600 dark:text-red-400" : "text-foreground"
                }`}
                numberOfLines={1}
              >
                {deadlineSaysDate && due
                  ? t`Due ${formatDate(due, undefined, locale)}`
                  : deadlineType}
              </Text>
            </View>
          ) : null}

          {due && !deadlineSaysDate ? (
            <Row
              icon={<CalendarDays size={16} color={colors.mutedForeground} />}
            >
              {/* The stored YYYY-MM-DD, parsed as a calendar date — a JS Date
                  renders the day before for anyone west of UTC. */}
              {formatDate(due, undefined, locale)}
            </Row>
          ) : null}

          {operation.salesOrderReadableId ? (
            <Row
              icon={<ReceiptText size={16} color={colors.mutedForeground} />}
            >
              {operation.salesOrderReadableId}
            </Row>
          ) : null}

          {customerName ? (
            <Row icon={<SquareUser size={16} color={colors.mutedForeground} />}>
              {customerName}
            </Row>
          ) : null}

          {scrapped > 0 ? (
            <View className="flex-row items-center gap-2">
              <Trash2 size={16} color={OVERDUE_COLOR} />
              <Text className="flex-1 text-sm text-red-600 dark:text-red-400">
                {t`${scrapped} scrapped`}
              </Text>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}
