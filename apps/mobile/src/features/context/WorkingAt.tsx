// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { Building2, ChevronRight } from "lucide-react-native";
import { Pressable, Text } from "react-native";
import { useThemeColors } from "~/components/useThemeColor";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * "Northspoke Cycles · Headquarters" — which company and location every row on
 * this screen belongs to, and the way to change it.
 *
 * The COMPANY is the half that was missing. The board used to say only
 * "Headquarters", and nearly every company has one: two accounts in two
 * companies showed two entirely different sets of work centres under the same
 * word, and nothing on screen said they were different companies. Web MES
 * carries the company in its sidebar the whole time; a phone has no sidebar,
 * so it goes where the location already was.
 *
 * It is a button because the answer to "this is not the board I expected" is
 * always this screen, and it was three taps away under More.
 */
export function WorkingAt() {
  const { t } = useLingui();
  const colors = useThemeColors();
  const { me, companyId, locationId } = useAuth();

  const company = me?.companies.find((c) => c.id === companyId)?.name ?? "";
  const location = me?.locations.find((l) => l.id === locationId)?.name ?? "";
  const label = [company, location].filter(Boolean).join(" · ");
  if (!label) return null;

  return (
    <Pressable
      onPress={() => router.push("/(app)/context")}
      accessibilityRole="button"
      accessibilityLabel={t`Working at ${label}. Change company or location`}
      // 44pt tall although the text is small: it is a target, not a caption.
      className="min-h-[44px] flex-row items-center gap-2 self-start active:opacity-60"
    >
      <Building2 size={16} color={colors.mutedForeground} />
      <Text className="shrink text-sm text-muted-foreground" numberOfLines={1}>
        {label}
      </Text>
      <ChevronRight size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}
