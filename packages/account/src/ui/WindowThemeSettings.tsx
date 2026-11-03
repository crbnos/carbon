// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  ColorPicker,
  cn,
  Switch,
  setWindowThemePreview,
  ToggleGroup,
  ToggleGroupItem,
  useWindowThemeValue
} from "@carbon/react";
import type { WindowTheme } from "@carbon/utils";
import {
  DEFAULT_WINDOW_THEME,
  normalizeHex,
  parseWindowTheme,
  randomWindowTheme,
  serializeWindowTheme,
  WINDOW_THEME_FIELD,
  WINDOW_THEMES,
  windowThemePreset,
  windowThemeSwatch,
  windowThemeTextColors
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";
import { LuCheck, LuShuffle } from "react-icons/lu";
import { useFetcher } from "react-router";
import { AccountSettingsSection } from "./AccountSettingsLayout";

// Every app's root action stores the choice as a cookie, per browser.
const ROOT_ACTION = "/";

// The toggle value of the custom card; never stored.
const CUSTOM = "custom";

// What the custom fields start from while no theme is set.
const CUSTOM_START = WINDOW_THEMES.find(
  (preset) => preset.name === "graphite"
)!;

// The default follows the mode with no tint: plain dark and plain light. Fixed
// colors, since the page's own variables carry the window theme's tint.
const DEFAULT_SWATCH = "linear-gradient(135deg, #18181b 58%, #f4f4f5 58%)";

// A color picker reports every pointer move; save once the pointer rests.
const SAVE_DELAY_MS = 400;

const gradientPresets = WINDOW_THEMES.filter((preset) => preset.gradient);
const solidPresets = WINDOW_THEMES.filter((preset) => !preset.gradient);

const CARD = cn(
  "h-12 justify-start gap-3 rounded-lg border border-border bg-transparent px-3 text-foreground",
  "hover:bg-accent hover:text-foreground",
  "data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:text-foreground",
  "hover:data-[state=on]:bg-accent"
);

/**
 * Account → Appearance → Window theme: colors the navigation rail and the
 * frame and tints the page. The frame reads a preview or the pending pick
 * (`useWindowTheme`), so a click or a color drag shows at once.
 */
export function WindowThemeSettings() {
  const { t } = useLingui();
  const fetcher = useFetcher();
  const value = useWindowThemeValue();
  const preset = windowThemePreset(value);
  const current = parseWindowTheme(value);
  const isCustom = current !== null && !preset;
  const selected =
    value === null ? DEFAULT_WINDOW_THEME : (preset?.name ?? CUSTOM);

  // A color drag paints through the preview at once and saves once, after the
  // pointer rests: each save revalidates every loader on the page.
  const unsaved = useRef<WindowTheme | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const save = (next: string) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    unsaved.current = null;
    fetcherRef.current.submit(
      { [WINDOW_THEME_FIELD]: next },
      { method: "post", action: ROOT_ACTION }
    );
  };

  // The pending save shows the value from here on, so the preview can end.
  const submitted = fetcher.formData;
  useEffect(() => {
    if (submitted && !unsaved.current) setWindowThemePreview(undefined);
  }, [submitted]);

  // Closing the pane mid-drag still saves the last color.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (unsaved.current) {
        fetcherRef.current.submit(
          { [WINDOW_THEME_FIELD]: serializeWindowTheme(unsaved.current) },
          { method: "post", action: ROOT_ACTION }
        );
        unsaved.current = null;
      }
      setWindowThemePreview(undefined);
    },
    []
  );

  const editing = current ?? CUSTOM_START;

  const saveCustom = (next: WindowTheme) => save(serializeWindowTheme(next));

  const onColorChange = (field: "base" | "highlight", input: string) => {
    const hex = normalizeHex(input);
    if (!hex) return;
    const next = { ...editing, [field]: hex };
    unsaved.current = next;
    setWindowThemePreview(serializeWindowTheme(next));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (unsaved.current) saveCustom(unsaved.current);
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

  return (
    <AccountSettingsSection
      title={<Trans>Window theme</Trans>}
      description={
        <Trans>Colors the navigation and the frame around each page.</Trans>
      }
    >
      <ToggleGroup
        type="single"
        size="sm"
        value={selected}
        onValueChange={onPick}
        aria-label={t`Window theme`}
        className="flex flex-col items-stretch gap-4"
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ThemeCard
            value={DEFAULT_WINDOW_THEME}
            label={t`Default`}
            swatch={DEFAULT_SWATCH}
            check="#71717a"
            active={selected === DEFAULT_WINDOW_THEME}
          />
          <ThemeCard
            value={CUSTOM}
            label={t`Custom`}
            swatch={windowThemeSwatch(editing)}
            check={`#${windowThemeTextColors(editing).text}`}
            active={isCustom}
          />
        </div>
        <PresetGroup title={<Trans>Gradient</Trans>}>
          {gradientPresets.map((option) => (
            <PresetCard
              key={option.name}
              preset={option}
              active={selected === option.name}
            />
          ))}
        </PresetGroup>
        <PresetGroup title={<Trans>Solid</Trans>}>
          {solidPresets.map((option) => (
            <PresetCard
              key={option.name}
              preset={option}
              active={selected === option.name}
            />
          ))}
        </PresetGroup>
      </ToggleGroup>

      <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            <Trans>Custom theme</Trans>
          </p>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<LuShuffle />}
            onClick={() => saveCustom(randomWindowTheme(editing.gradient))}
          >
            <Trans>Surprise me</Trans>
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ColorField label={<Trans>Window background</Trans>}>
            <ColorPicker
              value={`#${editing.base.toUpperCase()}`}
              onChange={(input) => onColorChange("base", input)}
            />
          </ColorField>
          <ColorField label={<Trans>Selected items</Trans>}>
            <ColorPicker
              value={`#${editing.highlight.toUpperCase()}`}
              onChange={(input) => onColorChange("highlight", input)}
            />
          </ColorField>
        </div>
        <GradientSwitch
          checked={editing.gradient}
          onCheckedChange={(gradient) => saveCustom({ ...editing, gradient })}
        />
      </div>
    </AccountSettingsSection>
  );
}

function PresetGroup({
  title,
  children
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function PresetCard({
  preset,
  active
}: {
  preset: (typeof WINDOW_THEMES)[number];
  active: boolean;
}) {
  return (
    <ThemeCard
      value={preset.name}
      label={preset.label}
      swatch={windowThemeSwatch(preset)}
      check={`#${windowThemeTextColors(preset).text}`}
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
        className="flex size-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/15"
        style={{ background: swatch }}
      >
        {active && <LuCheck className="size-3.5" style={{ color: check }} />}
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
          <Trans>Window gradient</Trans>
        </span>
        <span className="text-pretty text-xs text-muted-foreground">
          <Trans>
            Blend the window background into the selected items color.
          </Trans>
        </span>
      </label>
    </div>
  );
}
