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
  createTrailingCall,
  normalizeHex,
  pickableThemes,
  presetThemes,
  ROOT_ACTION_SAVE,
  randomThemeColors,
  serializeThemeColors,
  textColorOn,
  themeByName,
  themeStyle,
  themeSwatch,
  themeTextColors
} from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { LuCheck, LuShuffle } from "react-icons/lu";
import { useFetcher } from "react-router";
import { AccountSettingsSection } from "./AccountSettingsLayout";

// A custom theme's name is its colors, so the grid and the tab need a fixed value.
const CUSTOM = "custom";

const CUSTOM_START = presetThemes.find(
  (theme) => theme.name === "graphite"
)!.colors;

const SAVE_DELAY_MS = 400;

const PRESET_GROUPS = [
  { gradient: true, themes: presetThemes.filter((t) => t.colors.gradient) },
  { gradient: false, themes: presetThemes.filter((t) => !t.colors.gradient) }
];

const CARD = cn(
  "h-10 justify-start gap-2.5 rounded-lg border border-border bg-transparent px-3 text-foreground",
  "hover:bg-accent hover:text-foreground",
  "data-[state=on]:border-primary data-[state=on]:bg-transparent data-[state=on]:text-foreground",
  "hover:data-[state=on]:bg-accent"
);

/**
 * Account → Appearance → Theme. `withThemePresets` is off where the shell has
 * no frame to paint (the starter), which lists only the color themes.
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
  const previewAccent = useThemePreview(fetcher.state === "idle");

  const { submit } = fetcher;

  const save = (name: string) => {
    drag.take();
    // Preview the accent on <body> until the save lands, minus the variables
    // the page tint sets from the pending pick.
    const next = themeByName(name);
    const variables: Record<string, string> = next.cssVars[mode];
    const tinted = next.colors ? themeStyle(next.colors).content[mode] : {};
    previewAccent(
      Object.fromEntries(
        Object.entries(variables).filter(([key]) => !tinted[`--${key}`])
      )
    );
    submit({ theme: name }, ROOT_ACTION_SAVE);
  };

  // A drag previews every move but saves once the pointer rests.
  const saveLatest = useRef(save);
  useEffect(() => {
    saveLatest.current = save;
  });
  const [drag] = useState(() =>
    createTrailingCall<string>(SAVE_DELAY_MS, (name) =>
      saveLatest.current(name)
    )
  );

  const submitted = fetcher.formData;
  useEffect(() => {
    if (submitted && !drag.isPending()) setThemePreview(undefined);
  }, [submitted, drag]);

  // Closing the pane mid-drag still saves the last color.
  useEffect(
    () => () => {
      const unsaved = drag.take();
      if (unsaved) submit({ theme: unsaved }, ROOT_ACTION_SAVE);
      setThemePreview(undefined);
    },
    [drag, submit]
  );

  const editing = current.colors ?? CUSTOM_START;

  const saveCustom = (next: ThemeColors) => save(serializeThemeColors(next));

  const onColorChange = (field: "base" | "highlight", input: string) => {
    const hex = normalizeHex(input);
    if (!hex) return;
    const next = serializeThemeColors({ ...editing, [field]: hex });
    setThemePreview(next);
    drag.schedule(next);
  };

  const onPick = (next: string) => {
    // ToggleGroup deselects on a second click; keep the selection.
    if (!next || next === selected) return;
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
      {withThemePresets &&
        PRESET_GROUPS.map((group) => (
          <ThemeGroup
            key={String(group.gradient)}
            title={
              group.gradient ? <Trans>Gradient</Trans> : <Trans>Solid</Trans>
            }
          >
            {group.themes.map((theme) => (
              <PresetThemeCard
                key={theme.name}
                value={theme.name}
                label={theme.label}
                colors={theme.colors}
                mode={mode}
                active={selected === theme.name}
              />
            ))}
          </ThemeGroup>
        ))}
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
      check={`#${textColorOn(swatch)}`}
      active={active}
    />
  );
}

function PresetThemeCard({
  value,
  label,
  colors,
  mode,
  active
}: {
  value: string;
  label: string;
  colors: ThemeColors;
  mode: "light" | "dark";
  active: boolean;
}) {
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
  swatch: string;
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
