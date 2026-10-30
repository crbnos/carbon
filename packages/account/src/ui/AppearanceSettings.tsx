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
  useRouteData,
  useThemePreview,
  useUiScale
} from "@carbon/react";
import type { Density, TextSize } from "@carbon/utils";
import {
  densityValidator,
  modeValidator,
  pickableThemes,
  textSizeValidator,
  themeColorValidator
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { CSSProperties, ReactNode } from "react";
import {
  LuCheck,
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

// Every app's root action stores these as cookies, so each choice is per browser.
const ROOT_ACTION = "/";

const SEGMENTED_GROUP =
  "w-fit gap-0.5 rounded-lg border border-border bg-muted p-0.5";
const SEGMENTED_ITEM = cn(
  "rounded-md text-muted-foreground",
  "hover:bg-transparent hover:text-foreground",
  "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
  "hover:data-[state=on]:bg-background"
);

function linearChannel(value: number) {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * True when black reads better than white on a theme swatch (WCAG contrast).
 * Swatches are `"H S% L%"` strings, so yellow at 53% lightness still needs
 * dark ink.
 */
function isLightSwatch(hsl: string) {
  const [h = 0, s = 0, l = 0] = hsl
    .split(" ")
    .map((part, index) => Number.parseFloat(part) / (index === 0 ? 1 : 100));
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return linearChannel(l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05);
}

export default function AppearanceSettings() {
  const { t } = useLingui();
  const { transitionMode } = useAccountSettingsConfig();
  const mode = useMode();
  const modePreference = useModePreference();
  const modeFetcher = useFetcher();
  const themeFetcher = useFetcher();
  const textSizeFetcher = useFetcher();
  const densityFetcher = useFetcher();
  const { textSize, density } = useUiScale();
  const routeData = useRouteData<{ theme?: string }>(ROOT_ACTION);
  const themeOptions = pickableThemes();
  // Dropped once the save settles, so <html> shows the saved theme, or the
  // old one if it failed.
  const previewTheme = useThemePreview(themeFetcher.state === "idle");

  // The in-flight choice wins until the root loader revalidates with it.
  const pendingTheme = themeColorValidator.safeParse({
    theme: themeFetcher.formData?.get("theme")
  });
  const theme = pendingTheme.success
    ? pendingTheme.data.theme
    : (routeData?.theme ?? "zinc");

  const onModeChange = (value: string) => {
    const parsed = modeValidator.shape.mode.safeParse(value);
    if (!parsed.success || parsed.data === modePreference) return;
    const nextMode = parsed.data === "system" ? getSystemMode() : parsed.data;
    const persist = () =>
      modeFetcher.submit(
        { mode: parsed.data },
        { method: "post", action: ROOT_ACTION }
      );

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

  const onThemeChange = (value: string) => {
    const next = themeOptions.find((candidate) => candidate.name === value);
    if (!next || next.name === theme) return;
    // Preview at once, until the root loader applies it from the cookie.
    previewTheme(mode === "dark" ? next.cssVars.dark : next.cssVars.light);
    themeFetcher.submit(
      { theme: next.name },
      { method: "post", action: ROOT_ACTION }
    );
  };

  const onTextSizeChange = (value: string) => {
    const parsed = textSizeValidator.shape.textSize.safeParse(value);
    if (!parsed.success || parsed.data === textSize) return;
    textSizeFetcher.submit(
      { textSize: parsed.data },
      { method: "post", action: ROOT_ACTION }
    );
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
    densityFetcher.submit(
      { density: parsed.data },
      { method: "post", action: ROOT_ACTION }
    );
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
      <AccountSettingsSection
        title={<Trans>Theme color</Trans>}
        description={<Trans>The accent color used across Carbon.</Trans>}
      >
        <ToggleGroup
          type="single"
          size="sm"
          value={theme}
          onValueChange={onThemeChange}
          aria-label={t`Theme color`}
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {themeOptions.map((option) => {
            const active = option.name === theme;
            const swatch = option.activeColor[mode];
            return (
              <ToggleGroupItem
                key={option.name}
                value={option.name}
                style={
                  {
                    "--theme-primary": `hsl(${swatch})`
                  } as CSSProperties
                }
                className={cn(
                  "h-9 justify-start gap-2 rounded-lg border border-border bg-transparent px-3 text-foreground",
                  "hover:bg-accent hover:text-foreground",
                  "data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:text-foreground",
                  "hover:data-[state=on]:bg-accent"
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--theme-primary)]">
                  {active && (
                    <LuCheck
                      className={cn(
                        "size-3",
                        isLightSwatch(swatch) ? "text-black" : "text-white"
                      )}
                    />
                  )}
                </span>
                <span className="truncate">{option.label}</span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </AccountSettingsSection>
    </AccountSettingsPane>
  );
}
