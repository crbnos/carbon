// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * `user.avatarUrl` holds either a path in the public `avatars` bucket (an
 * uploaded photo) or a generated-avatar value: `dicebear:<style>:<seed>`, with
 * an optional `:<rrggbb>` background (none = the style's own). The
 * `@carbon/react` Avatar shows a generated value as an image the app draws on
 * the server (`/file/avatar/:value`). A user only gets one by choosing it on
 * their profile: a new user starts with no avatar and shows their initials.
 *
 * Every style here needs a loader in `@carbon/react`'s `generatedAvatar.ts`.
 * Removing a style stops existing values in it from rendering (they fall back
 * to initials), so only ever add.
 */
export const GENERATED_AVATAR_STYLES = [
  "croodles-neutral",
  "notionists",
  "notionists-neutral",
  "lorelei",
  "lorelei-neutral",
  "loops",
  "pixel-art",
  "voxel-art",
  "voxel-bot",
  "planets"
] as const;

export type GeneratedAvatarStyle = (typeof GENERATED_AVATAR_STYLES)[number];

export const DEFAULT_GENERATED_AVATAR_STYLE: GeneratedAvatarStyle =
  "croodles-neutral";

const GENERATED_AVATAR_PREFIX = "dicebear:";
const SEED_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function isGeneratedAvatarStyle(
  value: string
): value is GeneratedAvatarStyle {
  return (GENERATED_AVATAR_STYLES as readonly string[]).includes(value);
}

export type GeneratedAvatar = {
  style: GeneratedAvatarStyle;
  seed: string;
  /** Lowercase `rrggbb` without `#`, or `null` for the style's own background. */
  background: string | null;
};

const BACKGROUND_PATTERN = /^[0-9a-f]{6}$/;

/**
 * A background color as the value stores it: lowercase `rrggbb` without `#`.
 * Accepts `#abc`, `#AABBCC` or the same without `#`; anything else is `null`.
 */
export function normalizeAvatarBackground(
  input: string | null | undefined
): string | null {
  if (!input) return null;
  let hex = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) {
    hex = hex
      .split("")
      .map((digit) => digit + digit)
      .join("");
  }
  return BACKGROUND_PATTERN.test(hex) ? hex : null;
}

/**
 * Parses `dicebear:<style>:<seed>` or `dicebear:<style>:<seed>:<rrggbb>`. The
 * background segment is optional, so every value written before it existed
 * still parses.
 */
export function parseGeneratedAvatar(
  value: string | null | undefined
): GeneratedAvatar | null {
  if (!value?.startsWith(GENERATED_AVATAR_PREFIX)) return null;
  const parts = value.slice(GENERATED_AVATAR_PREFIX.length).split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const [style = "", seed = "", background] = parts;
  if (!isGeneratedAvatarStyle(style) || !SEED_PATTERN.test(seed)) return null;
  if (background !== undefined && !BACKGROUND_PATTERN.test(background)) {
    return null;
  }
  return { style, seed, background: background ?? null };
}

export function isGeneratedAvatar(
  value: string | null | undefined
): value is string {
  return parseGeneratedAvatar(value) !== null;
}

export function formatGeneratedAvatar({
  style,
  seed,
  background
}: GeneratedAvatar): string {
  const color = normalizeAvatarBackground(background);
  return `${GENERATED_AVATAR_PREFIX}${style}:${seed}${color ? `:${color}` : ""}`;
}

export function newGeneratedAvatarSeed(): string {
  return crypto.randomUUID();
}

export function newGeneratedAvatar(
  style: GeneratedAvatarStyle = DEFAULT_GENERATED_AVATAR_STYLE,
  background: string | null = null
): string {
  return formatGeneratedAvatar({
    style,
    seed: newGeneratedAvatarSeed(),
    background
  });
}

/**
 * The `src` for a stored avatar value. A generated avatar passes through as
 * it is (the `@carbon/react` Avatar renders it); an uploaded photo's path
 * becomes a URL through `toUrl`. Every app's `Avatar` wrapper uses this.
 */
export function avatarSrc(
  value: string | null | undefined,
  toUrl: (path: string) => string
): string | undefined {
  if (!value) return undefined;
  return isGeneratedAvatar(value) ? value : toUrl(value);
}

/**
 * An uploaded photo lives at the root of the public `avatars` bucket, named
 * `${userId}.<ext>` (the bucket's write policy requires the user's id as the
 * filename prefix).
 */
export function isOwnAvatarUpload(
  userId: string,
  value: string | null | undefined
): value is string {
  return (
    !!value &&
    value.length > userId.length + 1 &&
    value.startsWith(`${userId}.`) &&
    !value.includes("/")
  );
}

/** What a user may store in their own `user.avatarUrl`. */
export function isAllowedAvatarValue(
  userId: string,
  value: string | null | undefined
): value is string {
  return isGeneratedAvatar(value) || isOwnAvatarUpload(userId, value);
}
