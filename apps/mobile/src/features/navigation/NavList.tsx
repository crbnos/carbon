// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import {
  Activity,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  History,
  type LucideIcon,
  PackageCheck,
  ScanLine
} from "lucide-react-native";
import { Text, View } from "react-native";
import { PressableScale } from "~/components/PressableScale";
import { Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";

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
 */

type NavItem = { href: string; label: string; icon: LucideIcon };

export function NavList() {
  const { t } = useLingui();

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
        { href: "/(app)/(tabs)/active", label: t`Active`, icon: Activity },
        { href: "/(app)/(tabs)/recent", label: t`Recent`, icon: History },
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
    </View>
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
      <ChevronRight size={18} color={colors.mutedForeground} />
    </PressableScale>
  );
}
