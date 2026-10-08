// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import type { GeneratedAvatarStyle } from "@carbon/utils";
import { parseGeneratedAvatar } from "@carbon/utils";
import type { Style } from "@dicebear/core";
import { useEffect, useSyncExternalStore } from "react";

const log = getLogger("react", "generated-avatar");

// One loader per style. A style definition is 10–370 KB of JSON, so each
// style is its own chunk, fetched the first time something renders it.
// No `json` import attribute: Vite passes it through to the browser, which then
// rejects the style (Vite serves it as JavaScript) — the picker stayed grey.
// The server side instead bundles @dicebear/styles (`ssrNoExternal` in each
// app's vite.config.ts), because Node refuses a package's JSON without one.
// `Record` makes a style in GENERATED_AVATAR_STYLES without a loader a type
// error.
const STYLE_LOADERS: Record<GeneratedAvatarStyle, () => Promise<unknown>> = {
  "croodles-neutral": () => import("@dicebear/styles/croodles-neutral.json"),
  notionists: () => import("@dicebear/styles/notionists.json"),
  "notionists-neutral": () =>
    import("@dicebear/styles/notionists-neutral.json"),
  lorelei: () => import("@dicebear/styles/lorelei.json"),
  "lorelei-neutral": () => import("@dicebear/styles/lorelei-neutral.json"),
  loops: () => import("@dicebear/styles/loops.json"),
  "pixel-art": () => import("@dicebear/styles/pixel-art.json"),
  "voxel-art": () => import("@dicebear/styles/voxel-art.json"),
  "voxel-bot": () => import("@dicebear/styles/voxel-bot.json"),
  planets: () => import("@dicebear/styles/planets.json")
};

/**
 * The line-color options of the styles that draw lines straight onto the
 * background. On a dark background they switch to white so the face stays
 * visible. Notionists and Lorelei paint a white face first, so they need none.
 */
const INK_OPTIONS: Partial<Record<GeneratedAvatarStyle, readonly string[]>> = {
  "croodles-neutral": ["inkColor"],
  "notionists-neutral": ["inkColor"],
  "lorelei-neutral": ["eyebrowsColor", "eyesColor", "mouthColor", "noseColor"]
};

function channel(hex: string, offset: number) {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** True when white text reads better than black on `rrggbb` (WCAG contrast). */
export function isDarkBackground(hex: string) {
  const luminance =
    0.2126 * channel(hex, 0) +
    0.7152 * channel(hex, 2) +
    0.0722 * channel(hex, 4);
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05;
}

function backgroundOptions(
  style: GeneratedAvatarStyle,
  background: string | null
): Record<string, string[]> {
  if (!background) return {};
  const options: Record<string, string[]> = {
    backgroundColor: [`#${background}`]
  };
  if (isDarkBackground(background)) {
    for (const option of INK_OPTIONS[style] ?? [])
      options[option] = ["#ffffff"];
  }
  return options;
}

// The DiceBear core is about 156 KB minified (25 KB gzipped) and `Avatar` is
// in every app shell, so it is never imported statically: it loads with the
// first style an avatar needs. Keep every runtime use behind `core`.
type DiceBearCore = typeof import("@dicebear/core");
let core: DiceBearCore | undefined;

const styles = new Map<GeneratedAvatarStyle, Style>();
const pending = new Map<GeneratedAvatarStyle, Promise<void>>();
const failed = new Set<GeneratedAvatarStyle>();

export type GeneratedAvatarState =
  | { status: "ready"; src: string }
  | { status: "loading" }
  | { status: "failed" };

type ReadyState = Extract<GeneratedAvatarState, { status: "ready" }>;

// Rendered avatars, keyed by value. A list of people renders the same few
// avatars many times, so each is generated once. Least recently used first: a
// picker drag or shuffle produces a new value per step, so the cache is capped
// rather than kept for the whole session. One state object per value keeps
// `useSyncExternalStore`'s snapshot stable.
const MAX_CACHED_AVATARS = 300;
const rendered = new Map<string, ReadyState>();

function remember(value: string, state: ReadyState) {
  rendered.delete(value);
  rendered.set(value, state);
  if (rendered.size > MAX_CACHED_AVATARS) {
    const oldest = rendered.keys().next().value;
    if (oldest !== undefined) rendered.delete(oldest);
  }
}

function drawAvatar(
  dicebear: DiceBearCore,
  style: Style,
  avatar: NonNullable<ReturnType<typeof parseGeneratedAvatar>>
) {
  return new dicebear.Avatar(style, {
    seed: avatar.seed,
    ...backgroundOptions(avatar.style, avatar.background)
  });
}

/**
 * The SVG markup for a generated-avatar value, or `null` when the value is not
 * one or its style cannot load. Used on the server by `generatedAvatarLoader`.
 */
export async function renderGeneratedAvatarSvg(
  value: string
): Promise<string | null> {
  const parsed = parseGeneratedAvatar(value);
  if (!parsed) return null;
  await loadGeneratedAvatarStyle(parsed.style);
  const style = styles.get(parsed.style);
  if (!style || !core) return null;
  return drawAvatar(core, style, parsed).toString();
}

function renderReadyState(value: string): ReadyState | undefined {
  const cached = rendered.get(value);
  if (cached) {
    remember(value, cached);
    return cached;
  }

  const parsed = parseGeneratedAvatar(value);
  if (!parsed) return undefined;
  const style = styles.get(parsed.style);
  // A loaded style implies a loaded core; the check keeps the types honest.
  if (!style || !core) return undefined;

  const state: ReadyState = {
    status: "ready",
    src: drawAvatar(core, style, parsed).toDataUri()
  };
  remember(value, state);
  return state;
}

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Loads a style's definition once. Safe to call repeatedly. */
export function loadGeneratedAvatarStyle(
  style: GeneratedAvatarStyle
): Promise<void> {
  if (styles.has(style)) return Promise.resolve();
  const inFlight = pending.get(style);
  if (inFlight) return inFlight;
  failed.delete(style);

  const load = Promise.all([import("@dicebear/core"), STYLE_LOADERS[style]()])
    .then(([dicebear, module]) => {
      core = dicebear;
      const definition = (module as { default?: unknown }).default ?? module;
      styles.set(style, new dicebear.Style(definition));
      notify();
    })
    .catch((error) => {
      // Avatars in this style fall back to initials; the next one to mount
      // tries the load again.
      log.error("Failed to load avatar style", { style, error });
      failed.add(style);
      notify();
    })
    .finally(() => {
      pending.delete(style);
    });
  pending.set(style, load);
  return load;
}

/**
 * The SVG data URI for a generated-avatar value (`dicebear:<style>:<seed>`),
 * or `undefined` when the value is not one, or its style has not loaded yet.
 */
export function generatedAvatarDataUri(value: string): string | undefined {
  return renderReadyState(value)?.src;
}

const LOADING: GeneratedAvatarState = { status: "loading" };
const FAILED: GeneratedAvatarState = { status: "failed" };

function readState(value: string): GeneratedAvatarState {
  const ready = renderReadyState(value);
  if (ready) return ready;
  const style = parseGeneratedAvatar(value)?.style;
  return style && failed.has(style) ? FAILED : LOADING;
}

/**
 * The state of a generated-avatar value, loading its style on first use. It is
 * `loading` on the server, so the server render and hydration agree. Pass
 * `undefined` when the value is not a generated avatar (hooks cannot be
 * conditional); the result is then meaningless.
 */
export function useGeneratedAvatar(
  value: string | undefined
): GeneratedAvatarState {
  const state = useSyncExternalStore(
    subscribe,
    () => (value ? readState(value) : LOADING),
    () => LOADING
  );

  const style = value ? parseGeneratedAvatar(value)?.style : undefined;
  useEffect(() => {
    if (style) loadGeneratedAvatarStyle(style);
  }, [style]);

  return state;
}
