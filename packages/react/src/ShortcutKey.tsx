import { Fragment } from "react";
import type { IconType } from "react-icons";
import {
  LuArrowBigUp,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuChevronUp,
  LuCommand,
  LuCornerDownLeft,
  LuDelete,
  LuOption,
  LuSpace
} from "react-icons/lu";
import type { Modifier, ShortcutInput } from "./hooks/useShortcutKeys";
import { parseShortcut } from "./hooks/useShortcutKeys";

import { useOperatingSystem } from "./OperatingSystem";
import { cn } from "./utils/cn";

export const shortcutKeyVariants = {
  small:
    "flex h-4 min-w-4 items-center justify-center gap-0.5 rounded-[3px] border border-current/25 bg-white/10 px-1 ml-1.5 -mr-0.5 text-[0.65rem] font-medium uppercase text-current/80 shadow-sm backdrop-blur-sm",
  medium:
    "flex h-4.5 min-w-4.5 items-center justify-center gap-0.5 rounded-[3px] border border-current/25 bg-white/10 px-1 ml-1.5 -mr-0.5 text-[0.75rem] font-medium uppercase text-current/80 shadow-sm backdrop-blur-sm"
};

export type ShortcutKeyVariant = keyof typeof shortcutKeyVariants;

/**
 * Keys that render as a centered SVG instead of a letter — an icon beats a
 * text glyph for optical centering inside the keycap. Anything not listed
 * falls back to its text form.
 */
export const SHORTCUT_KEY_ICON_MAP: Partial<Record<string, IconType>> = {
  enter: LuCornerDownLeft,
  space: LuSpace,
  backspace: LuDelete,
  arrowup: LuChevronUp,
  arrowdown: LuChevronDown,
  arrowleft: LuChevronLeft,
  arrowright: LuChevronRight
};

type ShortcutKeyProps = {
  shortcut: ShortcutInput;
  variant: ShortcutKeyVariant;
  className?: string;
};

export const ShortcutKey = ({
  shortcut,
  variant,
  className
}: ShortcutKeyProps) => {
  const { platform } = useOperatingSystem();
  const isMac = platform === "mac";
  const relevantShortcut = parseShortcut(shortcut, isMac);
  if (!relevantShortcut) return null;
  const modifiers = relevantShortcut.modifiers ?? [];
  const character = keyString(String(relevantShortcut.key), isMac, variant);

  return (
    <span className={cn(shortcutKeyVariants[variant], className)}>
      {modifiers.map((k) => (
        <Fragment key={k}>{modifierNode(k, isMac, variant)}</Fragment>
      ))}
      {character}
    </span>
  );
};

function iconClassName(size: ShortcutKeyVariant) {
  return size === "small" ? "size-2.5 shrink-0" : "size-3 shrink-0";
}

function keyString(key: string, isMac: boolean, size: ShortcutKeyVariant) {
  key = key.toLowerCase();

  const Icon = SHORTCUT_KEY_ICON_MAP[key];
  if (Icon) {
    return <Icon className={iconClassName(size)} aria-hidden="true" />;
  }

  switch (key) {
    case "escape":
      return "esc";
    default:
      return key;
  }
}

function modifierNode(
  modifier: Modifier,
  isMac: boolean,
  size: ShortcutKeyVariant
) {
  const className = iconClassName(size);
  if (isMac) {
    switch (modifier) {
      case "alt":
        return <LuOption className={className} aria-hidden="true" />;
      case "ctrl":
        return "⌃";
      case "meta":
      case "mod":
        return <LuCommand className={className} aria-hidden="true" />;
      case "shift":
        return <LuArrowBigUp className={className} aria-hidden="true" />;
    }
  }
  switch (modifier) {
    case "alt":
      return "Alt+";
    case "ctrl":
      return "Ctrl+";
    case "meta":
      return "⊞+";
    case "shift":
      return "Shift+";
    case "mod":
      return "Ctrl+";
  }
}
