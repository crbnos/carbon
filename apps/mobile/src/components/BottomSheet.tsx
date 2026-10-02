// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView
} from "@gorhom/bottom-sheet";
import type { LucideIcon } from "lucide-react-native";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useRef
} from "react";
import { Pressable, Text, View } from "react-native";
import { Heading } from "./ui";
import { useThemeColors } from "./useThemeColor";

/**
 * Every secondary action lives in a sheet, never in a context menu — there is
 * no right-click on a tablet and nothing may be revealed on hover.
 *
 * Rows are 56pt and their icons are muted. Colour is spent only where the
 * colour IS the meaning: Scrap is red because scrapping a part is destructive,
 * and nothing else in the sheet competes with it.
 */

export type SheetHandle = {
  open: () => void;
  close: () => void;
};

export const Sheet = forwardRef<
  SheetHandle,
  { title?: string; children: ReactNode }
>(function Sheet({ title, children }, ref) {
  const sheet = useRef<BottomSheetModal>(null);
  const colors = useThemeColors();

  useImperativeHandle(ref, () => ({
    open: () => sheet.current?.present(),
    close: () => sheet.current?.dismiss()
  }));

  // Tapping the backdrop dismisses. An operator who opened the wrong sheet
  // should not have to find a close button to get back to the work.
  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    []
  );

  return (
    <BottomSheetModal
      ref={sheet}
      backdropComponent={backdrop}
      enableDynamicSizing
      // This library takes a style object, not a Uniwind className, so it
      // cannot read `--card` — hence `themeColor`. A sheet that stayed white in
      // dark mode would be the brightest thing on a night-shift tablet.
      backgroundStyle={{ backgroundColor: colors.card }}
      handleIndicatorStyle={{
        backgroundColor: colors.mutedForeground,
        width: 48
      }}
    >
      <BottomSheetScrollView contentContainerClassName="gap-1 px-4 pb-10 pt-2">
        {title ? <Heading className="px-2 pb-2">{title}</Heading> : null}
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

export function SheetRow({
  icon: Icon,
  label,
  description,
  onPress,
  tone = "default",
  disabled = false,
  /** Why it is disabled. The row stays visible and says so (design rule). */
  disabledReason
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  /** Optional: a row that is disabled has nothing to do. */
  onPress?: () => void;
  tone?: "default" | "destructive";
  disabled?: boolean;
  disabledReason?: string;
}) {
  const destructive = tone === "destructive";
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={disabled ? disabledReason : undefined}
      className={`min-h-[56px] flex-row items-center gap-4 rounded-lg px-2 ${
        disabled ? "opacity-40" : "active:bg-muted"
      }`}
    >
      <Icon
        size={24}
        color={destructive ? colors.destructive : colors.mutedForeground}
      />
      <View className="flex-1 gap-0.5">
        <Text
          className={`text-base font-medium ${
            destructive ? "text-red-600 dark:text-red-400" : "text-foreground"
          }`}
        >
          {label}
        </Text>
        {disabled && disabledReason ? (
          <Text className="text-sm text-muted-foreground">
            {disabledReason}
          </Text>
        ) : description ? (
          <Text className="text-sm text-muted-foreground">{description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
