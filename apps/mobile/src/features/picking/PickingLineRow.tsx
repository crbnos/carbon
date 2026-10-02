// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PickingListLine } from "@carbon/mes-core";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import { TriangleAlert, Undo2 } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { toast } from "sonner-native";
import { StatusBadge } from "~/components/StatusBadge";
import { Body, Button, Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { commandMessage, usePickQuantity, usePickTracked } from "./commands";
import {
  isLineFullyPicked,
  isOutOfStock,
  lineBinName,
  pickedLots,
  quantityOutstanding
} from "./logic";

/**
 * One line of a kit: what to fetch, from where, how much of it is in the box,
 * and the one action that moves it along.
 *
 * Laid out in the order `x+/picking.$pickingListId.tsx` uses — identity, then
 * source, then count, then controls — but stacked rather than in a row,
 * because a kitter holds the tablet in one hand and the part in the other.
 *
 * The counts are "4 of 10 EA" rather than the web's `4/10` badge: the design
 * rules want a number with its context, and a kitter reading a rack needs the
 * unit of measure as much as the figure.
 *
 * **A locked list disables every control in place with the reason.** It never
 * hides them. `disabledReason` is rendered as text under the row, not only as
 * an accessibility hint, because the kitter looking for the missing Pick button
 * is the person who needs to read it.
 *
 * The tracked and untracked halves are genuinely different commands, not one
 * with a flag: an untracked line is picked by QUANTITY in one tap, and a
 * tracked line has to name the lots it took so the genealogy can be written.
 */
export function PickingLineRow({
  listId,
  line,
  isTracked,
  locked,
  lockedReason,
  onShort,
  onScan
}: {
  listId: string;
  line: PickingListLine;
  isTracked: boolean;
  locked: boolean;
  lockedReason?: string;
  onShort: () => void;
  onScan: () => void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  const pickQuantity = usePickQuantity(listId);
  const pickTracked = usePickTracked(listId);

  const toPick = line.quantityToPick ?? 0;
  const picked = line.quantityPicked ?? 0;
  const unit = line.item?.unitOfMeasureCode ?? null;
  const fullyPicked = isLineFullyPicked(line);
  const cancelled = line.status === "Cancelled";
  const lots = pickedLots(line);
  const bin = lineBinName(line);
  const outstanding = quantityOutstanding(line);
  const busy = pickQuantity.isPending || pickTracked.isPending;

  const quantityLabel = unit
    ? t`${formatQuantity(picked, locale)} of ${formatQuantity(toPick, locale)} ${unit}`
    : t`${formatQuantity(picked, locale)} of ${formatQuantity(toPick, locale)}`;

  const pickAll = async () => {
    try {
      await pickQuantity.mutateAsync({ lineId: line.id, quantity: toPick });
      toast.success(t`Picked ${formatQuantity(toPick, locale)}`);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not pick this line`));
    }
  };

  const unpickAll = async () => {
    try {
      // Zero WITHOUT `markShort` is how the web unpicks: it clears the pick
      // rather than recording "this is all there was", so the line goes back
      // to owing its full quantity instead of being resolved as Short.
      await pickQuantity.mutateAsync({ lineId: line.id, quantity: 0 });
      toast.success(t`Unpicked`);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not unpick this line`));
    }
  };

  const unpickLot = async (trackedEntityId: string, quantity: number) => {
    try {
      await pickTracked.mutateAsync({
        lineId: line.id,
        trackedEntityId,
        quantity,
        unpick: true
      });
      toast.success(t`Unpicked`);
    } catch (error) {
      toast.error(commandMessage(error, t`Could not unpick that lot`));
    }
  };

  return (
    <View
      className={`gap-3 border-b border-border p-4 ${
        fullyPicked || cancelled ? "opacity-70" : ""
      }`}
    >
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Body className="font-semibold" numberOfLines={2}>
            {line.item?.name ?? line.item?.readableId ?? line.itemId}
          </Body>
          {line.item?.readableId ? (
            <Muted className="text-sm">{line.item.readableId}</Muted>
          ) : null}
        </View>
        <StatusBadge entity="pickingListLine" status={line.status} />
      </View>

      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-xl font-semibold text-foreground">
            {quantityLabel}
          </Text>
          {outstanding > 0 && picked > 0 ? (
            <Muted className="text-sm">
              {t`${formatQuantity(outstanding, locale)} still to pick`}
            </Muted>
          ) : null}
        </View>
        {bin ? (
          <Muted className="text-base font-medium">{bin}</Muted>
        ) : isOutOfStock(line) && !fullyPicked ? (
          // A warning, never a disabled button: the kitter MAY pick it, and
          // on-hand goes negative until the count is reconciled. That is web's
          // behaviour and the reason it is worded as a fact, not a refusal.
          <View className="flex-row items-center gap-1.5">
            <TriangleAlert size={16} color={colors.destructive} />
            <Text className="text-sm font-medium text-orange-600 dark:text-orange-400">
              {t`No stock on record`}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Picked lots, each its own 48pt Unpick target. The web puts a second
          and later lot behind a dropdown; there is no dropdown on a tablet, and
          an action hidden in a menu is one a gloved thumb never finds. */}
      {lots.length > 0 ? (
        <View className="gap-2">
          {lots.map((lot) => (
            <Pressable
              key={lot.trackedEntityId}
              onPress={() =>
                void unpickLot(lot.trackedEntityId, lot.quantityPicked)
              }
              disabled={locked || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: locked || busy }}
              accessibilityHint={locked ? lockedReason : undefined}
              accessibilityLabel={t`Unpick ${lot.readableId ?? lot.trackedEntityId}`}
              className={`min-h-[48px] flex-row items-center justify-between gap-3 rounded-lg border border-border bg-muted px-3 ${
                locked || busy ? "opacity-40" : "active:opacity-70"
              }`}
            >
              <Body className="min-w-0 flex-1 text-sm" numberOfLines={1}>
                {lot.readableId ?? lot.trackedEntityId}
                {unit
                  ? ` · ${formatQuantity(lot.quantityPicked, locale)} ${unit}`
                  : ` · ${formatQuantity(lot.quantityPicked, locale)}`}
              </Body>
              <Undo2 size={20} color={colors.mutedForeground} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {cancelled ? (
        <Muted className="text-sm">{t`This line was cancelled.`}</Muted>
      ) : isTracked ? (
        !fullyPicked ? (
          // Icons are NOT passed as `Button` children: `ui.tsx`'s Button wraps
          // its children in a `<Text>`, and an SVG inside a Text does not
          // render on React Native. The label carries the meaning instead.
          <Button
            variant="primary"
            onPress={onScan}
            disabled={locked || busy}
            accessibilityLabel={t`Choose a lot to pick`}
          >
            {t`Choose a lot`}
          </Button>
        ) : null
      ) : fullyPicked ? (
        <Button
          variant="secondary"
          onPress={unpickAll}
          disabled={locked}
          loading={busy}
        >
          {t`Unpick`}
        </Button>
      ) : (
        // One dominant action per state: Pick is the primary, Short is the
        // secondary question for when the shelf could not fill it.
        <View className="flex-row gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onPress={onShort}
            disabled={locked || busy}
          >
            {t`Short`}
          </Button>
          {/*
            "Pick all" because that is what the command does: `pickQuantity`
            SETS the line's picked quantity to the full ask, it does not add to
            it. Labelling it with the outstanding figure on a part-picked line
            would describe an addition the server is not making.
          */}
          <Button
            className="flex-1"
            onPress={pickAll}
            disabled={locked}
            loading={busy}
          >
            {unit
              ? t`Pick all ${formatQuantity(toPick, locale)} ${unit}`
              : t`Pick all ${formatQuantity(toPick, locale)}`}
          </Button>
        </View>
      )}

      {locked && lockedReason && !cancelled ? (
        <Muted className="text-sm">{lockedReason}</Muted>
      ) : null}
    </View>
  );
}
