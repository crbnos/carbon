// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard as OperationCardData } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { Pressable, View } from "react-native";
import { BigNumber } from "~/components/BigNumber";
import { StatusBadge } from "~/components/StatusBadge";
import { Body, Card, Muted } from "~/components/ui";

/**
 * What an operator scans a card for, in the order web MES shows it
 * (`apps/mes/app/components/OperationsList.tsx`): the item, a big quantity
 * with context, the job, and the status as text AND colour.
 *
 * The whole card is the press target — a 48pt row is the minimum for a gloved
 * thumb, and there is nothing to hover on a tablet.
 */

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
  const { t } = useLingui();
  const done = operation.quantityCompleted ?? 0;
  const target = operation.targetQuantity ?? operation.quantity ?? 0;

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
        className={`gap-3 active:opacity-80 ${
          selected ? "border-ring bg-accent" : ""
        }`}
      >
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
          <StatusBadge entity="jobOperation" status={operation.status} />
        </View>

        <View className="flex-row items-end justify-between gap-3">
          <BigNumber value={done} of={target} />
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
