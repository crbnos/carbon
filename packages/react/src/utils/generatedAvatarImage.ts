// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// What `Avatar` needs to show a generated avatar: the URL of its server-drawn
// SVG and the classes of the <img>. Kept apart from `generatedAvatar.ts` on
// purpose — `Avatar` renders on every page, and importing the renderer would
// pull its style chunks and hooks into every bundle, client and server.

import type { GeneratedAvatarStyle } from "@carbon/utils";

/**
 * Bump when the same value would draw a different picture: a DiceBear
 * upgrade, or a change to the rendering options in `generatedAvatar.ts`. It
 * is part of every avatar URL, and those responses are cached forever, so
 * without a bump browsers keep the old image.
 */
export const GENERATED_AVATAR_RENDER_VERSION = "1";

/**
 * Where `Avatar` loads a generated avatar from: each app serves it from
 * `/file/avatar/:value` (`generatedAvatarLoader`, `@carbon/react/GeneratedAvatar`).
 * Same-origin and relative, so it works in the ERP, MES and academy alike.
 */
export function generatedAvatarUrl(value: string) {
  return `/file/avatar/${encodeURIComponent(value)}?v=${GENERATED_AVATAR_RENDER_VERSION}`;
}

/**
 * Styles drawn as black lines on a transparent background. `Avatar` puts them
 * on white in both themes. The rest are full color with their own background.
 */
const LINE_ART_STYLES: ReadonlySet<GeneratedAvatarStyle> = new Set([
  "croodles-neutral",
  "notionists",
  "notionists-neutral",
  "lorelei",
  "lorelei-neutral"
]);

function isLineArtStyle(style: GeneratedAvatarStyle) {
  return LINE_ART_STYLES.has(style);
}

/**
 * The classes `Avatar` puts on a generated avatar's image. Line-art styles are
 * black lines on transparent, so they sit on white in both themes; color
 * styles keep their own colors. A chosen background paints over either.
 */
export function generatedAvatarClassName(style: GeneratedAvatarStyle) {
  return isLineArtStyle(style)
    ? "bg-white border-black/10"
    : "bg-muted border-transparent";
}
