// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { router } from "expo-router";
import { UserRound } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Body, Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * Who the tablet is currently working as.
 *
 * Shown ONLY in terminal mode, and always when in it. On a shared tablet the
 * single most consequential thing on screen is whose name the next write will
 * carry, and an operator who cannot see it has no way to notice that the
 * person before them never pinned out.
 *
 * Tapping it goes to the PIN screen, which is both "switch operator" and "pin
 * out" — the same destination, because on a floor those are one act.
 */
export function OperatorHeader() {
  const { t } = useLingui();
  const colors = useThemeColors();
  const { terminalToken, operator } = useAuth();

  if (!terminalToken) return null;

  return (
    <Pressable
      onPress={() => router.push("/(app)/pin")}
      accessibilityRole="button"
      accessibilityLabel={
        operator ? t`Switch operator from ${operator.name}` : t`Pin in`
      }
      className={`min-h-[48px] flex-row items-center gap-3 border-b px-4 py-2 ${
        operator
          ? "border-border bg-card"
          : // No operator is not a neutral state on a shared terminal: every
            // write would be attributed to the terminal account.
            "border-orange-500/40 bg-orange-500/10"
      } active:opacity-80`}
    >
      <UserRound size={20} color={colors.mutedForeground} />
      <View className="flex-1">
        {operator ? (
          <>
            <Muted className="text-sm">{t`Working as`}</Muted>
            <Body className="font-semibold">{operator.name}</Body>
          </>
        ) : (
          <Body className="font-semibold">{t`Nobody is pinned in — tap to pin in`}</Body>
        )}
      </View>
      <Muted className="text-sm">{t`Switch`}</Muted>
    </Pressable>
  );
}
