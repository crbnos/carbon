// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import {
  Activity,
  Briefcase,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  History,
  type LucideIcon,
  PackageCheck,
  PowerOff,
  ScanLine
} from "lucide-react-native";
import { useState } from "react";
import { Text, View } from "react-native";
import { PressableScale } from "~/components/PressableScale";
import { Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { useActiveQuery } from "~/features/operations/useQueueQueries";
import { EndShiftDialog } from "~/features/timecard/EndShiftDialog";
import { useTimecardQuery } from "~/features/timecard/useTimecardQuery";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * Every destination the tablet's rail shows, as a list — the phone's way in.
 *
 * A phone's bottom bar holds five before the labels truncate, which is the
 * bug that made it unusable once before. The rail has no such limit, so the
 * two cannot show the same set: the bar carries the ones an operator is in
 * all shift, and this list carries everything.
 *
 * It is a full-screen list reached from the bar rather than a drawer that
 * slides in from the left. A drawer's handle lives at the top-left — the
 * furthest point from a thumb, and the hardest to reach for someone holding
 * a part in the other hand. Coming from the bottom bar keeps every touch in
 * the bottom third of the screen, and it is what iOS itself does when a tab
 * bar overflows.
 *
 * Grouped as web's sidebar is grouped, so the two apps teach each other.
 *
 * It renders on a TABLET too, even though the rail already carries most of
 * it. Some entries are not rail icons and cannot be: End Operations stops
 * every running timer in the plant, and an unlabelled icon for that sitting
 * between Scan and Time is an accident waiting to happen. Those live here,
 * where they have a name and a sentence.
 */

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

export function NavList() {
  const { t } = useLingui();
  const { operator } = useAuth();
  const activeCount = useActiveQuery().data?.operations?.length ?? 0;
  // Week 0: the open entry is this week's by definition, and the dialog needs
  // it to say what clocking out will close.
  const openEntry = useTimecardQuery(0).data?.openEntry ?? null;
  const [endingOperations, setEndingOperations] = useState(false);

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: t`Operations`,
      items: [
        {
          href: "/(app)/(tabs)/operations",
          label: t`Schedule`,
          icon: CalendarDays
        },
        {
          href: "/(app)/(tabs)/assigned",
          label: t`Assigned to Me`,
          icon: ClipboardList
        },
        {
          href: "/(app)/(tabs)/active",
          label: t`Active`,
          icon: Activity,
          badge: activeCount
        },
        { href: "/(app)/(tabs)/recent", label: t`Recent`, icon: History },
        { href: "/(app)/(tabs)/jobs", label: t`Jobs`, icon: Briefcase },
        {
          href: "/(app)/(tabs)/picking",
          label: t`Picking`,
          icon: PackageCheck
        }
      ]
    },
    {
      label: t`Tools`,
      items: [{ href: "/(app)/(tabs)/scan", label: t`Scan`, icon: ScanLine }]
    }
  ];

  return (
    <View className="gap-4">
      {groups.map((group) => (
        <View key={group.label} className="gap-1">
          <Muted className="px-1 text-sm font-semibold uppercase tracking-wide">
            {group.label}
          </Muted>
          {group.items.map((item) => (
            <NavRow key={item.href} item={item} />
          ))}
        </View>
      ))}

      {/*
        An ACTION, not a destination — web's sidebar has it as a button too.
        It closes every open production event without completing anything,
        which is why it is spelled out in a confirmation rather than fired
        from a row, and why it is not an unlabelled icon on the rail.
      */}
      <View className="gap-1">
        <ActionRow
          label={t`End Operations`}
          icon={PowerOff}
          onPress={() => setEndingOperations(true)}
        />
      </View>

      <EndShiftDialog
        open={endingOperations}
        openEntry={openEntry}
        operatorPinnedIn={Boolean(operator)}
        onClose={() => setEndingOperations(false)}
      />
    </View>
  );
}

function ActionRow({
  label,
  icon: Icon,
  onPress
}: {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-[56px] flex-row items-center gap-3 rounded-lg border border-border bg-card px-4"
    >
      <Icon size={20} color={colors.mutedForeground} />
      <Text className="flex-1 text-base text-foreground">{label}</Text>
    </PressableScale>
  );
}

function NavRow({ item }: { item: NavItem }) {
  const colors = useThemeColors();
  const Icon = item.icon;
  return (
    <PressableScale
      // `navigate`, not `push`: these are siblings, not a drill-down. Pushing
      // would stack Assigned on Active on Recent behind a Back button nobody
      // wants, and walk the hardware back button through every queue the
      // operator had glanced at.
      onPress={() => router.navigate(item.href as never)}
      accessibilityRole="link"
      accessibilityLabel={item.label}
      className="min-h-[56px] flex-row items-center gap-3 rounded-lg border border-border bg-card px-4"
    >
      <Icon size={20} color={colors.mutedForeground} />
      <Text className="flex-1 text-base text-foreground">{item.label}</Text>
      {item.badge ? (
        <View className="h-6 min-w-[24px] items-center justify-center rounded-full bg-primary px-1.5">
          <Text className="text-xs font-semibold text-primary-foreground">
            {item.badge > 99 ? "99+" : item.badge}
          </Text>
        </View>
      ) : null}
      <ChevronRight size={18} color={colors.mutedForeground} />
    </PressableScale>
  );
}
