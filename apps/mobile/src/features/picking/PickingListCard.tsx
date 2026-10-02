// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { PickingListCard as PickingListCardData } from "@carbon/mes-core";
import { formatDate } from "@carbon/utils/date";
import { useLingui } from "@lingui/react/macro";
import { CalendarClock } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { StatusBadge } from "~/components/StatusBadge";
import { Body, Card, Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { cardProgress } from "./logic";

/**
 * One assigned list, in the order web MES shows it
 * (`x+/picking._index.tsx`): the list number, the status as text AND colour,
 * where it is, when it is due, and how far through it is.
 *
 * The progress is "6 of 14 lines" rather than the web's "6/14 · 43%". A
 * percentage is a number a kitter cannot act on; the count tells them how many
 * boxes are left to fill, and the design rules require the context.
 *
 * The whole card is the press target — 48pt minimum for a gloved thumb, and
 * there is nothing to hover on a tablet.
 */
export function PickingListCard({
  list,
  onPress
}: {
  list: PickingListCardData;
  onPress: () => void;
}) {
  const { t, i18n } = useLingui();
  const colors = useThemeColors();
  const { done, total } = cardProgress(list);
  const label = list.pickingListId ?? list.id;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t`Open picking list ${label}`}
    >
      <Card className="gap-3 active:opacity-80">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-1">
            <Body className="font-semibold">{label}</Body>
            {list.locationName ? (
              <Muted className="text-sm">{list.locationName}</Muted>
            ) : null}
          </View>
          <StatusBadge entity="pickingList" status={list.status} />
        </View>

        <View className="flex-row items-end justify-between gap-3">
          {/*
            Not `BigNumber`: these are LINES, not a quantity in a unit of
            measure, so `formatQuantity`'s five decimals would be wrong for
            them and the number is only as interesting as its context.
          */}
          <Body className="text-base font-medium">
            {t`${done} of ${total} lines`}
          </Body>
          {list.dueDate ? (
            <View className="flex-row items-center gap-1.5">
              <CalendarClock size={16} color={colors.mutedForeground} />
              {/*
                `formatDate` on the stored `YYYY-MM-DD`, never `new Date(…)`:
                that parses a bare date as UTC midnight and renders the day
                BEFORE for anyone west of UTC, so a list due today would read
                as overdue on a Californian night shift.
              */}
              <Muted className="text-sm">
                {formatDate(list.dueDate, undefined, i18n.locale || undefined)}
              </Muted>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}
