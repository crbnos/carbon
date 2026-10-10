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
  useRouteData
} from "@carbon/react";
import { modeValidator, themeColorValidator, themes } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { CSSProperties } from "react";
import { LuCheck, LuLaptop, LuMoon, LuSun } from "react-icons/lu";
import { useFetcher } from "react-router";
import {
  AccountSettingsPane,
  AccountSettingsSection
} from "./AccountSettingsLayout";
import { useAccountSettingsConfig } from "./context";

// Every app's root action stores both as cookies, so the choice is per browser.
const ROOT_ACTION = "/";

export default function AppearanceSettings() {
  const { t } = useLingui();
  const { transitionMode } = useAccountSettingsConfig();
  const mode = useMode();
  const modePreference = useModePreference();
  const modeFetcher = useFetcher();
  const themeFetcher = useFetcher();
  const routeData = useRouteData<{ theme?: string }>(ROOT_ACTION);

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
    const next = themes.find((candidate) => candidate.name === value);
    if (!next || next.name === theme) return;
    // Preview at once; the root loader applies it from the cookie on the
    // next render.
    const variables = mode === "dark" ? next.cssVars.dark : next.cssVars.light;
    Object.entries(variables).forEach(([key, color]) => {
      document.body.style.setProperty(`--${key}`, color);
    });
    themeFetcher.submit(
      { theme: next.name },
      { method: "post", action: ROOT_ACTION }
    );
  };

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
            className="w-fit gap-0.5 rounded-lg border border-border bg-muted p-0.5"
          >
            {modeOptions.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                className={cn(
                  "gap-1.5 rounded-md px-3 text-muted-foreground",
                  "hover:bg-transparent hover:text-foreground",
                  "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
                  "hover:data-[state=on]:bg-background"
                )}
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
          {themes.map((option) => {
            const active = option.name === theme;
            return (
              <ToggleGroupItem
                key={option.name}
                value={option.name}
                style={
                  {
                    "--theme-primary": `hsl(${option.activeColor[mode]})`
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
                  {active && <LuCheck className="size-3 text-white" />}
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
