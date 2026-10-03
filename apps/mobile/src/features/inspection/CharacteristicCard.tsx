// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import {
  Check,
  ChevronRight,
  Gauge as GaugeIcon,
  X
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View
} from "react-native";
import { Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import type { Row } from "./logic";

/**
 * One characteristic of the unit currently selected — one CELL of the web's
 * grid, given the room a touch target needs.
 *
 * A reading commits on blur and on the keyboard's return, and only when it
 * differs from what is stored; that is the web grid's contract, kept so the
 * same keystrokes produce the same writes. It deliberately does NOT commit per
 * keystroke: "0.2" is on the way to "0.250" and is a failing reading on its
 * own, and a failed reading's valuation is kept forever — the server stores
 * the verdict AT ENTRY and a later edit never rewrites it.
 */

const STATUS_RING: Record<string, string> = {
  Passed: "border-emerald-600/50 bg-emerald-500/10",
  Failed: "border-red-500/50 bg-red-500/10"
};

export function CharacteristicCard({
  row,
  status,
  value,
  gaugeLabel,
  disabled,
  saving,
  recorded,
  active = false,
  onActivate,
  onCommitValue,
  onToggle,
  onPickGauge
}: {
  row: Row;
  /** This cell's verdict, or undefined when nothing is recorded yet. */
  status: string | undefined;
  value: number | null;
  /** The gauge recorded for this characteristic on this lot, if any. */
  gaugeLabel: string | null;
  disabled: boolean;
  saving: boolean;
  /** How many readings this characteristic has, against the n it needs. */
  recorded: { recorded: number; failed: number } | undefined;
  /** This characteristic is the one the drawing's balloon is highlighting. */
  active?: boolean;
  /** Touching the card highlights its balloon — the link, read the other way. */
  onActivate?: () => void;
  onCommitValue: (value: string) => void;
  onToggle: (passed: "true" | "false") => void;
  onPickGauge?: () => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();
  const [draft, setDraft] = useState(value == null ? "" : String(value));

  // Re-sync when the stored reading changes underneath — a save response, or
  // a different unit selected into this same card.
  useEffect(() => {
    setDraft(value == null ? "" : String(value));
  }, [value]);

  const commit = () => {
    const stored = value == null ? "" : String(value);
    if (draft.trim() === stored) return;
    onCommitValue(draft.trim());
  };

  return (
    <View
      className={`gap-3 rounded-lg border bg-card p-4 ${
        (status && STATUS_RING[status]) || "border-border"
      } ${active ? "border-[#f97316]" : ""}`}
    >
      <Pressable
        onPress={onActivate}
        accessibilityRole="button"
        accessibilityLabel={t`Show ${row.label} on the drawing`}
        className="flex-row items-start justify-between gap-3"
      >
        <View className="min-w-0 flex-1">
          <Text
            className="text-base font-semibold text-foreground"
            numberOfLines={2}
          >
            {row.label}
          </Text>
          {row.specLabel ? (
            // Tabular so a column of readings lines up against its nominal.
            <Text className="text-sm tabular-nums text-muted-foreground">
              {row.specLabel}
            </Text>
          ) : null}
          {row.description ? (
            <Muted className="text-sm" numberOfLines={2}>
              {row.description}
            </Muted>
          ) : null}
        </View>
        {saving ? <ActivityIndicator /> : null}
      </Pressable>

      {row.isNumeric ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onFocus={onActivate}
          onBlur={commit}
          onSubmitEditing={commit}
          editable={!disabled}
          // `decimal-pad` rather than `numeric`: a reading is never negative
          // and never exponential, and the pad is the larger-keyed one.
          keyboardType="decimal-pad"
          returnKeyType="done"
          placeholder={t`Reading`}
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel={t`Reading for ${row.label}`}
          className={`min-h-[56px] rounded-lg border border-input bg-background px-4 text-center text-xl tabular-nums text-foreground ${
            disabled ? "opacity-50" : ""
          }`}
        />
      ) : (
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => onToggle("true")}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: status === "Passed" }}
            accessibilityLabel={t`Pass ${row.label}`}
            className={`min-h-[56px] flex-1 flex-row items-center justify-center gap-2 rounded-lg border active:opacity-70 ${
              status === "Passed"
                ? "border-emerald-600 bg-emerald-500/15"
                : "border-border bg-background"
            } ${disabled ? "opacity-50" : ""}`}
          >
            <Check
              size={20}
              color={status === "Passed" ? "#059669" : colors.mutedForeground}
            />
            <Text
              className={`text-base font-semibold ${
                status === "Passed"
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground"
              }`}
            >
              {t`Pass`}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => onToggle("false")}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: status === "Failed" }}
            accessibilityLabel={t`Fail ${row.label}`}
            className={`min-h-[56px] flex-1 flex-row items-center justify-center gap-2 rounded-lg border active:opacity-70 ${
              status === "Failed"
                ? "border-red-500 bg-red-500/15"
                : "border-border bg-background"
            } ${disabled ? "opacity-50" : ""}`}
          >
            <X
              size={20}
              color={status === "Failed" ? "#dc2626" : colors.mutedForeground}
            />
            <Text
              className={`text-base font-semibold ${
                status === "Failed"
                  ? "text-red-700 dark:text-red-400"
                  : "text-muted-foreground"
              }`}
            >
              {t`Fail`}
            </Text>
          </Pressable>
        </View>
      )}

      <View className="flex-row items-center justify-between gap-2">
        {/* Progress against the PLAN, not against the units on screen: n is
            what the characteristic needs before the lot may be accepted. */}
        <Muted className="text-sm">
          {recorded
            ? t`${recorded.recorded} of ${row.sampleSize} recorded`
            : t`${row.sampleSize} needed`}
        </Muted>
        {recorded && recorded.failed > 0 ? (
          <Text className="text-sm text-red-600 dark:text-red-400">
            {t`${recorded.failed} failed`}
          </Text>
        ) : null}
      </View>

      {row.gaugeTypeId && onPickGauge ? (
        <Pressable
          onPress={onPickGauge}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={t`Choose the gauge for ${row.label}`}
          className={`min-h-[48px] flex-row items-center gap-2 rounded-lg border border-border bg-background px-3 active:opacity-70 ${
            disabled ? "opacity-50" : ""
          }`}
        >
          <GaugeIcon size={18} color={colors.mutedForeground} />
          <Text className="flex-1 text-base text-foreground" numberOfLines={1}>
            {gaugeLabel ?? t`Choose a gauge`}
          </Text>
          <ChevronRight size={18} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}
