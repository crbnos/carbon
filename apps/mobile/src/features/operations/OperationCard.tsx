// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard as OperationCardData } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { useLingui } from "@lingui/react/macro";
import {
  CalendarDays,
  Circle,
  CircleCheck,
  CirclePlay,
  CircleX,
  ClipboardCheck,
  type LucideIcon,
  Pause,
  Play,
  Timer
} from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Card } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";

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
 */

/** `OperationStatusIcon` from `apps/mes/app/components/Icons.tsx`. */
function statusIcon(status: string | null | undefined): {
  Icon: LucideIcon;
  tone: "foreground" | "blue" | "red" | "green" | "orange";
} {
  switch (status) {
    case "Ready":
      return { Icon: Circle, tone: "blue" };
    case "Waiting":
    case "Canceled":
    case "Cancelled":
      return { Icon: CircleX, tone: "red" };
    case "Done":
      return { Icon: CircleCheck, tone: "green" };
    case "In Progress":
      return { Icon: Play, tone: "orange" };
    case "Paused":
      return { Icon: Pause, tone: "orange" };
    default:
      return { Icon: Circle, tone: "foreground" };
  }
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
  selected = false
}: {
  operation: OperationCardData;
  onPress: () => void;
  /** Marked in the tablet's two-pane layout: the card IS the current screen. */
  selected?: boolean;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();

  const { Icon: StatusIcon, tone } = statusIcon(operation.status);
  const statusColors: Record<typeof tone, string> = {
    foreground: colors.foreground,
    blue: "#2563eb",
    red: "#dc2626",
    green: "#16a34a",
    orange: "#ea580c"
  };
  const target = operation.targetQuantity ?? operation.quantity ?? 0;
  const due = operation.dueDate ?? null;

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
        className={`gap-3 active:opacity-80 ${cardTone(operation.status)} ${
          selected ? "border-ring bg-accent" : ""
        }`}
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
          <Text className="text-xl font-semibold text-muted-foreground">
            {target}
          </Text>
        </View>

        {/* One row per fact, in the web's order. */}
        <View className="gap-2">
          {operation.jobReadableId ? (
            <Row icon={<CirclePlay size={16} color={colors.mutedForeground} />}>
              {operation.jobReadableId}
            </Row>
          ) : null}

          {operation.description ? (
            <Row
              icon={<ClipboardCheck size={16} color={colors.mutedForeground} />}
            >
              {operation.description}
            </Row>
          ) : null}

          {operation.status ? (
            <Row icon={<StatusIcon size={16} color={statusColors[tone]} />}>
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

          {due ? (
            <Row
              icon={<CalendarDays size={16} color={colors.mutedForeground} />}
            >
              {/* The stored YYYY-MM-DD, parsed as a calendar date — a JS Date
                  renders the day before for anyone west of UTC. */}
              {formatDate(String(due).slice(0, 10), undefined, locale)}
            </Row>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}
