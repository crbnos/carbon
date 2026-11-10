// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cn,
  getSystemMode,
  ToggleGroup,
  ToggleGroupItem,
  useMode,
  useModePreference,
  useUiScale
} from "@carbon/react";
import type { Density, TextSize } from "@carbon/utils";
import {
  densityValidator,
  modeValidator,
  ROOT_ACTION_SAVE,
  textSizeValidator
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import {
  LuLaptop,
  LuMoon,
  LuRows2,
  LuRows3,
  LuRows4,
  LuSun
} from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  AccountSettingsPane,
  AccountSettingsSection
} from "./AccountSettingsLayout";
import { useAccountSettingsConfig } from "./context";
import { ThemeSettings } from "./ThemeSettings";

const SEGMENTED_GROUP =
  "w-fit gap-0.5 rounded-lg border border-border bg-muted p-0.5";
const SEGMENTED_ITEM = cn(
  "rounded-md text-muted-foreground",
  "hover:bg-transparent hover:text-foreground",
  "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
  "hover:data-[state=on]:bg-background"
);

export default function AppearanceSettings() {
  const { t } = useLingui();
  const { transitionMode, themePresets } = useAccountSettingsConfig();
  const mode = useMode();
  const modePreference = useModePreference();
  const modeFetcher = useFetcher();
  const textSizeFetcher = useFetcher();
  const densityFetcher = useFetcher();
  const { textSize, density } = useUiScale();

  const onModeChange = (value: string) => {
    const parsed = modeValidator.shape.mode.safeParse(value);
    if (!parsed.success || parsed.data === modePreference) return;
    const nextMode = parsed.data === "system" ? getSystemMode() : parsed.data;
    const persist = () =>
      modeFetcher.submit({ mode: parsed.data }, ROOT_ACTION_SAVE);

    if (nextMode === mode) {
      persist();
    } else if (transitionMode) {
      transitionMode(nextMode, persist);
    } else {
      // Drop a theme preview written for the old mode.
      document.body.removeAttribute("style");
      persist();
    }
  };

  const onTextSizeChange = (value: string) => {
    const parsed = textSizeValidator.shape.textSize.safeParse(value);
    if (!parsed.success || parsed.data === textSize) return;
    textSizeFetcher.submit({ textSize: parsed.data }, ROOT_ACTION_SAVE);
  };

  const textSizeOptions: { value: TextSize; label: string; sample: number }[] =
    [
      { value: "smaller", label: t`Smaller`, sample: 10 },
      { value: "small", label: t`Small`, sample: 12 },
      { value: "default", label: t`Default`, sample: 14 },
      { value: "large", label: t`Large`, sample: 16 },
      { value: "larger", label: t`Larger`, sample: 18 }
    ];

  const onDensityChange = (value: string) => {
    const parsed = densityValidator.shape.density.safeParse(value);
    if (!parsed.success || parsed.data === density) return;
    densityFetcher.submit({ density: parsed.data }, ROOT_ACTION_SAVE);
  };

  const densityOptions: { value: Density; label: string; icon: ReactNode }[] = [
    { value: "compact", label: t`Compact`, icon: <LuRows4 /> },
    { value: "default", label: t`Default`, icon: <LuRows3 /> },
    { value: "comfortable", label: t`Comfortable`, icon: <LuRows2 /> }
  ];

  const modeOptions = [
    { value: "light", label: t`Light`, icon: <LuSun /> },
    { value: "dark", label: t`Dark`, icon: <LuMoon /> },
    { value: "system", label: t`System`, icon: <LuLaptop /> }
  ];

  return (
    <AccountSettingsPane
      title={<Trans>Appearance</Trans>}
      description={<Trans>How Carbon looks in this browser.</Trans>}
    >
      <AccountSettingsSection
        title={<Trans>Mode</Trans>}
        description={<Trans>Light, dark, or follow your system setting.</Trans>}
        action={
          <ToggleGroup
            type="single"
            size="sm"
            value={modePreference}
            onValueChange={onModeChange}
            aria-label={t`Mode`}
            className={SEGMENTED_GROUP}
          >
            {modeOptions.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className={cn(SEGMENTED_ITEM, "gap-1.5 px-3")}
              >
                {option.icon}
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <AccountSettingsSection
        title={<Trans>Text size</Trans>}
        description={
          <Trans>Bigger or smaller text. The layout stays put.</Trans>
        }
        action={
          <ToggleGroup
            type="single"
            size="sm"
            value={textSize}
            onValueChange={onTextSizeChange}
            aria-label={t`Text size`}
            className={SEGMENTED_GROUP}
          >
            {textSizeOptions.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={option.label}
                title={option.label}
                className={cn(SEGMENTED_ITEM, "w-9 px-0 font-medium")}
              >
                {/* px on purpose: each sample keeps its own size at any setting. */}
                <span aria-hidden style={{ fontSize: `${option.sample}px` }}>
                  A
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <AccountSettingsSection
        title={<Trans>Density</Trans>}
        description={
          <Trans>Tighter or roomier layout. The text stays put.</Trans>
        }
        action={
          <ToggleGroup
            type="single"
            size="sm"
            value={density}
            onValueChange={onDensityChange}
            aria-label={t`Density`}
            className={SEGMENTED_GROUP}
          >
            {densityOptions.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className={cn(SEGMENTED_ITEM, "gap-1.5 px-3")}
              >
                {option.icon}
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <ThemeSettings withThemePresets={Boolean(themePresets)} />
    </AccountSettingsPane>
  );
}
