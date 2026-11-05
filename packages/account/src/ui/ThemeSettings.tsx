// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  ColorPicker,
  cn,
  Switch,
  setThemePreview,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  useMode,
  useThemePreview,
  useThemeValue
} from "@carbon/react";
import type { Theme, ThemeColors } from "@carbon/utils";
import {
  normalizeHex,
  pickableThemes,
  presetThemes,
  randomThemeColors,
  serializeThemeColors,
  themeByName,
  themeStyle,
  themeSwatch,
  themeTextColors
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { LuCheck, LuShuffle } from "react-icons/lu";
import { useFetcher } from "react-router";
import { AccountSettingsSection } from "./AccountSettingsLayout";

// Every app's root action stores the theme as a cookie, per browser. Only the
// root loader reads it, so the save re-runs no other loader (each root's
// `shouldRevalidate` opts back in).
const ROOT_ACTION = "/";
const SAVE_OPTIONS = {
  method: "post",
  action: ROOT_ACTION,
  defaultShouldRevalidate: false
} as const;

// The toggle value of the custom card. A custom theme's own name is its
// colors (`custom:<base>:<highlight>:<g|s>`), so the card needs a fixed one.
const CUSTOM = "custom";

// What the custom fields start from while the theme has no `colors`.
const CUSTOM_START = presetThemes.find(
  (theme) => theme.name === "graphite"
)!.colors;

// A color picker reports every pointer move; save once the pointer rests.
const SAVE_DELAY_MS = 400;

const gradientThemes = presetThemes.filter((theme) => theme.colors.gradient);
const solidThemes = presetThemes.filter((theme) => !theme.colors.gradient);

const CARD = cn(
  "h-10 justify-start gap-2.5 rounded-lg border border-border bg-transparent px-3 text-foreground",
  "hover:bg-accent hover:text-foreground",
  "data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:text-foreground",
  "hover:data-[state=on]:bg-accent"
);

function linearChannel(value: number) {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * True when black reads better than white on a color theme's swatch (WCAG
 * contrast). Swatches are `"H S% L%"` strings, so yellow at 53% lightness still
 * needs dark ink.
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

/**
 * Account → Appearance → Theme: one choice, one `theme` cookie. A color
 * theme sets the accent. A gradient, solid or custom theme also colors the
 * frame, the navigation rail, the module sidebar and the page
 * (`useThemeStyle`). Every pick shows at once: the frame reads a preview or
 * the pending pick, and the accent is painted on `<body>` until the save
 * lands. `withThemePresets` is off where the shell has no frame to paint (the
 * starter), which lists the color themes only.
 */
export function ThemeSettings({
  withThemePresets
}: {
  withThemePresets: boolean;
}) {
  const { t } = useLingui();
  const mode = useMode();
  const fetcher = useFetcher();
  const value = useThemeValue();
  const current = themeByName(value);
  const isCustom = value.startsWith("custom:");
  const selected = isCustom ? CUSTOM : value;
  const colorThemes = pickableThemes();
  // Dropped once the save settles, so <html> shows the saved theme, or the
  // old one if it failed.
  const previewAccent = useThemePreview(fetcher.state === "idle");

  // A color drag paints through the preview at once and saves once, after the
  // pointer rests: each save is a request and re-runs the root loader.
  const unsaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const submit = (name: string) =>
    fetcherRef.current.submit({ theme: name }, SAVE_OPTIONS);

  const save = (name: string) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    unsaved.current = null;
    // The accent is on <html>, which the loader updates only after the save;
    // paint it on <body> now. A theme's page tint comes from the
    // pending pick on <html>, so the preview leaves those variables alone.
    const next = themeByName(name);
    const variables: Record<string, string> =
      mode === "dark" ? next.cssVars.dark : next.cssVars.light;
    const tinted = next.colors ? themeStyle(next.colors).content[mode] : {};
    previewAccent(
      Object.fromEntries(
        Object.entries(variables).filter(([key]) => !tinted[`--${key}`])
      )
    );
    submit(name);
  };

  // The pending save shows the value from here on, so the preview can end.
  const submitted = fetcher.formData;
  useEffect(() => {
    if (submitted && !unsaved.current) setThemePreview(undefined);
  }, [submitted]);

  // Closing the pane mid-drag still saves the last color.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (unsaved.current) {
        fetcherRef.current.submit({ theme: unsaved.current }, SAVE_OPTIONS);
        unsaved.current = null;
      }
      setThemePreview(undefined);
    },
    []
  );

  const editing = current.colors ?? CUSTOM_START;

  const saveCustom = (next: ThemeColors) => save(serializeThemeColors(next));

  const onColorChange = (field: "base" | "highlight", input: string) => {
    const hex = normalizeHex(input);
    if (!hex) return;
    const next = serializeThemeColors({ ...editing, [field]: hex });
    unsaved.current = next;
    setThemePreview(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (unsaved.current) save(unsaved.current);
    }, SAVE_DELAY_MS);
  };

  const onPick = (next: string) => {
    // A click on the selected card deselects it in a ToggleGroup: keep it.
    if (!next || next === selected) return;
    if (next === CUSTOM) {
      saveCustom(editing);
      return;
    }
    save(next);
  };

  const themeGrid = (
    <ToggleGroup
      type="single"
      size="sm"
      value={selected}
      onValueChange={onPick}
      aria-label={t`Theme`}
      className="flex flex-col items-stretch gap-4"
    >
      <ThemeGroup title={withThemePresets ? <Trans>Color</Trans> : null}>
        {colorThemes.map((theme) => (
          <ColorThemeCard
            key={theme.name}
            theme={theme}
            mode={mode}
            active={selected === theme.name}
          />
        ))}
      </ThemeGroup>
      {withThemePresets && (
        <>
          <ThemeGroup title={<Trans>Gradient</Trans>}>
            {gradientThemes.map((theme) => (
              <PresetThemeCard
                key={theme.name}
                value={theme.name}
                label={theme.label}
                colors={theme.colors}
                active={selected === theme.name}
              />
            ))}
          </ThemeGroup>
          <ThemeGroup title={<Trans>Solid</Trans>}>
            {solidThemes.map((theme) => (
              <PresetThemeCard
                key={theme.name}
                value={theme.name}
                label={theme.label}
                colors={theme.colors}
                active={selected === theme.name}
              />
            ))}
          </ThemeGroup>
        </>
      )}
    </ToggleGroup>
  );

  if (!withThemePresets) {
    return (
      <AccountSettingsSection
        title={<Trans>Theme</Trans>}
        description={<Trans>The accent color used across Carbon.</Trans>}
      >
        {themeGrid}
      </AccountSettingsSection>
    );
  }

  // The ready-made themes and the custom editor share one place, in 2 tabs
  // (as Slack does), so the pane does not run long. The tab opens on the kind
  // of theme in use.
  return (
    <Tabs defaultValue={isCustom ? CUSTOM : "themes"}>
      <AccountSettingsSection
        title={<Trans>Theme</Trans>}
        description={
          <Trans>
            A color sets the accent. Gradient and solid themes also color the
            navigation, the sidebar and the page.
          </Trans>
        }
        action={
          <TabsList>
            <TabsTrigger value="themes">
              <Trans>Themes</Trans>
            </TabsTrigger>
            <TabsTrigger value={CUSTOM}>
              <Trans>Custom theme</Trans>
            </TabsTrigger>
          </TabsList>
        }
      >
        <TabsContent value="themes">{themeGrid}</TabsContent>
        <TabsContent value={CUSTOM} className="flex flex-col gap-4">
          {/* Editing a color, the gradient or "Surprise me" makes the custom
              theme the one in use, so the tab needs no card of its own. */}
          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<LuShuffle />}
              onClick={() => saveCustom(randomThemeColors(editing.gradient))}
            >
              <Trans>Surprise me</Trans>
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ColorField label={<Trans>Background</Trans>}>
              <ColorPicker
                aria-label={t`Background`}
                value={`#${editing.base.toUpperCase()}`}
                onChange={(input) => onColorChange("base", input)}
              />
            </ColorField>
            <ColorField label={<Trans>Selected items</Trans>}>
              <ColorPicker
                aria-label={t`Selected items`}
                value={`#${editing.highlight.toUpperCase()}`}
                onChange={(input) => onColorChange("highlight", input)}
              />
            </ColorField>
          </div>
          <GradientSwitch
            checked={editing.gradient}
            onCheckedChange={(gradient) => saveCustom({ ...editing, gradient })}
          />
        </TabsContent>
      </AccountSettingsSection>
    </Tabs>
  );
}

function ThemeGroup({
  title,
  children
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {title && (
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{children}</div>
    </div>
  );
}

function ColorThemeCard({
  theme,
  mode,
  active
}: {
  theme: Theme;
  mode: "light" | "dark";
  active: boolean;
}) {
  const swatch = theme.activeColor[mode];
  return (
    <ThemeCard
      value={theme.name}
      label={theme.label}
      swatch={`hsl(${swatch})`}
      check={isLightSwatch(swatch) ? "#000000" : "#ffffff"}
      active={active}
    />
  );
}

function PresetThemeCard({
  value,
  label,
  colors,
  active
}: {
  value: string;
  label: string;
  colors: ThemeColors;
  active: boolean;
}) {
  // The swatch shows the frame this mode paints: vivid in light mode, deep in
  // dark mode.
  const mode = useMode();
  return (
    <ThemeCard
      value={value}
      label={label}
      swatch={themeSwatch(colors, mode)}
      check={`#${themeTextColors(colors, mode).text}`}
      active={active}
    />
  );
}

function ThemeCard({
  value,
  label,
  swatch,
  check,
  active
}: {
  value: string;
  label: string;
  /** The swatch's CSS `background`. */
  swatch: string;
  /** The check mark's color, readable on the swatch. */
  check: string;
  active: boolean;
}) {
  return (
    <ToggleGroupItem value={value} aria-label={label} className={CARD}>
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
        style={{ background: swatch }}
      >
        {active && <LuCheck className="size-3" style={{ color: check }} />}
      </span>
      <span className="truncate">{label}</span>
    </ToggleGroupItem>
  );
}

function ColorField({
  label,
  children
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function GradientSwitch({
  checked,
  onCheckedChange
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        variant="small"
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="mt-0.5"
      />
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-sm">
          <Trans>Gradient</Trans>
        </span>
        <span className="text-pretty text-xs text-muted-foreground">
          <Trans>Blend the background into the selected items color.</Trans>
        </span>
      </label>
    </div>
  );
}
