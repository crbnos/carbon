// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as cookie from "cookie";
import { z } from "zod";

/**
 * Text size and density are two separate choices, stored per browser like the
 * mode. Browser zoom scales text and layout together; these do not. Text size
 * grows the text and keeps the layout; density changes the spacing and keeps
 * the text. No cookie means `default`. Written by the apps' root action.
 */
export const TEXT_SIZE_COOKIE = "text-size";
export const DENSITY_COOKIE = "density";

/** The root font size of each text size, in px at a 16px browser default. */
export const TEXT_SIZES = {
  smaller: 14,
  small: 15,
  default: 16,
  large: 18,
  larger: 20
} as const;

/** How much each density multiplies the spacing (padding, gaps, heights). */
export const DENSITIES = {
  compact: 0.875,
  default: 1,
  comfortable: 1.125
} as const;

export type TextSize = keyof typeof TEXT_SIZES;
export type Density = keyof typeof DENSITIES;

export const textSizeValidator = z.object({
  textSize: z.enum(["smaller", "small", "default", "large", "larger"])
});

export const densityValidator = z.object({
  density: z.enum(["compact", "default", "comfortable"])
});

export type UiScale = { textSize: TextSize; density: Density };

export function asTextSize(value: unknown): TextSize {
  const parsed = textSizeValidator.shape.textSize.safeParse(value);
  return parsed.success ? parsed.data : "default";
}

export function asDensity(value: unknown): Density {
  const parsed = densityValidator.shape.density.safeParse(value);
  return parsed.success ? parsed.data : "default";
}

export function getUiScaleFromCookies(cookieHeader: string | null): UiScale {
  const cookies = cookieHeader ? cookie.parse(cookieHeader) : {};
  return {
    textSize: asTextSize(cookies[TEXT_SIZE_COOKIE]),
    density: asDensity(cookies[DENSITY_COOKIE])
  };
}

/**
 * The `<html>` style for a text size and density. Every size in the apps is
 * rem, so the root font size grows text and layout alike; dividing Tailwind's
 * `--spacing` by the same factor holds the layout still, and the density then
 * scales the spacing alone. Empty at default, so the stylesheet decides.
 */
export function uiScaleStyle({ textSize, density }: UiScale): {
  fontSize?: string;
  "--spacing"?: string;
} {
  const textScale = TEXT_SIZES[textSize] / TEXT_SIZES.default;
  const spacingScale = DENSITIES[density] / textScale;
  return {
    // A percentage, so a larger browser default font size still counts.
    ...(textSize === "default" ? {} : { fontSize: `${textScale * 100}%` }),
    ...(spacingScale === 1
      ? {}
      : { "--spacing": `calc(0.25rem * ${spacingScale})` })
  };
}
