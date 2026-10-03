// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyMaterial, AssemblyTool } from "@carbon/mes-core";
import { formatQuantity } from "@carbon/utils/format";
import { useLingui } from "@lingui/react/macro";
import {
  Barcode,
  CircleCheck,
  CircleDot,
  Circle as CircleIcon,
  Wrench
} from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import type { MaterialState } from "./logic";

const ISSUED = "#10b981";
const PARTIAL = "#f59e0b";

/**
 * The parts for the step on screen, with this unit's issue state.
 *
 * A port of web's `MaterialRow`: a status dot (issued, partly issued, not
 * issued), the part's name over its number, the count hard right, and the
 * tracking chips under it — "Requires scan" in orange until a serial or lot
 * has been issued to this unit. The whole row is the action, as on the web: a
 * tracked part stays tappable once issued so its serial can be checked or
 * replaced, and an untracked part stops being a button once it is all in.
 */
export function PartsList({
  states,
  currentStepNumber,
  onIssue
}: {
  states: MaterialState<AssemblyMaterial>[];
  /** 1-based, for the "used on this step" emphasis. Null with no steps. */
  currentStepNumber: number | null;
  onIssue: (state: MaterialState<AssemblyMaterial>) => void;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm font-semibold uppercase text-muted-foreground">
          {t`Parts`}
        </Text>
        {states.length ? (
          <View className="flex-row items-center gap-1.5">
            <Barcode size={14} color={colors.mutedForeground} />
            <Muted className="text-sm">{t`Scan a part to issue it`}</Muted>
          </View>
        ) : null}
      </View>
      {states.length ? (
        states.map((state) => (
          <PartRow
            key={state.material.id ?? state.material.itemId ?? ""}
            state={state}
            usedHere={
              currentStepNumber != null &&
              state.stepNumbers.includes(currentStepNumber)
            }
            onPress={() => onIssue(state)}
          />
        ))
      ) : (
        <Muted className="text-sm">{t`No parts for this step.`}</Muted>
      )}
    </View>
  );
}

function PartRow({
  state,
  usedHere,
  onPress
}: {
  state: MaterialState<AssemblyMaterial>;
  usedHere: boolean;
  onPress: () => void;
}) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  const { material, required, issued, fullyIssued, isTracked } = state;

  // An unplanned part has nothing outstanding: once any of it is in, it is in.
  const isExtra = required === 0;
  const extraIssued = isExtra && issued > 0;
  const partial = !isExtra && issued > 0 && !fullyIssued;
  const complete = fullyIssued || extraIssued;
  const interactive = isTracked || !fullyIssued;
  const quantity = (value: number) => formatQuantity(value, locale);

  return (
    <Pressable
      onPress={onPress}
      disabled={!interactive}
      accessibilityRole={interactive ? "button" : undefined}
      accessibilityLabel={
        isTracked
          ? t`Scan ${material.itemReadableId ?? ""}`
          : t`Issue ${material.itemReadableId ?? ""}`
      }
      className={`min-h-[60px] flex-row items-start gap-3 rounded-lg border bg-card px-3 py-2.5 ${
        usedHere ? "border-foreground/40" : "border-border"
      } ${interactive ? "active:opacity-70" : ""}`}
    >
      <View className="pt-0.5">
        {complete ? (
          <CircleCheck size={18} color={ISSUED} />
        ) : partial ? (
          <CircleDot size={18} color={PARTIAL} />
        ) : (
          <CircleIcon size={18} color={colors.mutedForeground} />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text
          className="text-base font-medium text-foreground"
          numberOfLines={2}
        >
          {material.description ?? material.itemReadableId ?? t`Unnamed part`}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {material.itemReadableId}
          {state.stepNumbers.length
            ? `  ·  ${t`Step ${state.stepNumbers.join(", ")}`}`
            : ""}
        </Text>
      </View>
      <View className="items-end gap-1">
        {complete ? (
          <Text className="text-sm font-semibold" style={{ color: ISSUED }}>
            {`${quantity(issued)}/${quantity(required)}`}
          </Text>
        ) : partial ? (
          <Text className="text-sm" style={{ color: PARTIAL }}>
            {`${quantity(issued)}/${quantity(required)}`}
          </Text>
        ) : (
          <Text className="text-sm text-muted-foreground">
            {`×${quantity(required)}`}
          </Text>
        )}
        {isExtra ? <Chip label={t`Added`} /> : null}
        {isTracked ? (
          <View className="flex-row flex-wrap justify-end gap-1">
            <Chip
              label={material.requiresSerialTracking ? t`Serial` : t`Batch`}
            />
            {fullyIssued ? null : <Chip label={t`Requires scan`} tone="scan" />}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Chip({
  label,
  tone = "muted"
}: {
  label: string;
  tone?: "muted" | "scan";
}) {
  return (
    <View
      className={`rounded-md px-1.5 py-0.5 ${
        tone === "scan" ? "bg-orange-500/15" : "bg-muted"
      }`}
    >
      <Text
        className={`text-xs font-semibold ${
          tone === "scan"
            ? "text-orange-600 dark:text-orange-400"
            : "text-muted-foreground"
        }`}
      >
        {label}
      </Text>
    </View>
  );
}

/** The tools for the step on screen: web's tool cards, a wrench and a count. */
export function ToolsList({ tools }: { tools: AssemblyTool[] }) {
  const { t, i18n } = useLingui();
  const locale = i18n.locale || "en";
  const colors = useThemeColors();
  if (!tools.length) return null;
  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold uppercase text-muted-foreground">
        {t`Tools`}
      </Text>
      {tools.map((tool, index) => (
        <View
          key={tool.item?.id ?? index}
          className="min-h-[56px] flex-row items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
        >
          <Wrench size={18} color={colors.mutedForeground} />
          <View className="min-w-0 flex-1">
            <Text
              className="text-base font-medium text-foreground"
              numberOfLines={1}
            >
              {tool.item?.name ?? t`Tool`}
            </Text>
            {tool.item?.readableId ? (
              <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                {tool.item.readableId}
              </Text>
            ) : null}
          </View>
          <Text className="text-sm text-muted-foreground">
            {`×${formatQuantity(tool.quantity, locale)}`}
          </Text>
        </View>
      ))}
    </View>
  );
}
