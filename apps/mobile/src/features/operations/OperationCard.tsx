// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard as OperationCardData } from "@carbon/mes-core";
import { statusColor } from "@carbon/utils/status-colors";
import { useLingui } from "@lingui/react/macro";
import { Pressable, View } from "react-native";
import { Body, Card, Muted } from "~/components/ui";

/**
 * What an operator scans a card for, in the order web MES shows it
 * (`apps/mes/app/components/OperationsList.tsx`): the item, a big quantity
 * with context, the job, and the status as text AND colour.
 *
 * The whole card is the press target — a 48pt row is the minimum for a gloved
 * thumb, and there is nothing to hover on a tablet.
 */

const STATUS_CLASSES: Record<string, string> = {
  green: "bg-emerald-500",
  emerald: "bg-emerald-500",
  blue: "bg-blue-500",
  yellow: "bg-yellow-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  gray: "bg-muted-foreground",
  zinc: "bg-muted-foreground"
};

function statusDotClass(status: string | null | undefined) {
  if (!status) return STATUS_CLASSES.gray;
  // Shared with the web so the two cannot drift on what "In Progress" looks like.
  const color = statusColor("jobOperation", status);
  return (color && STATUS_CLASSES[color]) ?? STATUS_CLASSES.gray;
}

export function OperationCard({
  operation,
  onPress
}: {
  operation: OperationCardData;
  onPress: () => void;
}) {
  const { t } = useLingui();
  const done = operation.quantityCompleted ?? 0;
  const target = operation.targetQuantity ?? operation.quantity ?? 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t`Open operation ${
        operation.itemReadableId ?? operation.jobReadableId ?? ""
      }`}
    >
      <Card className="gap-3 active:opacity-80">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            {operation.itemReadableId ? (
              <Body className="font-semibold">{operation.itemReadableId}</Body>
            ) : null}
            <Muted className="text-sm" numberOfLines={2}>
              {operation.itemDescription ??
                operation.description ??
                operation.itemReadableId ??
                ""}
            </Muted>
          </View>
          <View className="flex-row items-center gap-2">
            <View
              className={`size-3 rounded-full ${statusDotClass(operation.status)}`}
            />
            <Muted className="text-sm">{operation.status ?? ""}</Muted>
          </View>
        </View>

        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-row items-baseline gap-2">
            <Body className="text-3xl font-semibold">{done}</Body>
            <Muted className="text-sm">{t`of ${target}`}</Muted>
          </View>
          <View className="items-end gap-1">
            {operation.jobReadableId ? (
              <Muted className="text-sm">{operation.jobReadableId}</Muted>
            ) : null}
            {operation.batchReadableId ? (
              <Muted className="text-sm">
                {operation.batchSize
                  ? t`Batch of ${operation.batchSize}`
                  : operation.batchReadableId}
              </Muted>
            ) : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}
