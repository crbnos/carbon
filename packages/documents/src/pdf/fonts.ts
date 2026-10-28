// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Font } from "@react-pdf/renderer";
import { BUNDLED_FONTS } from "./fonts.data";

// Fonts are bundled as base64 woff (fonts.data.ts, built by
// `pnpm --filter @carbon/documents build`) and registered in-process — no network
// at render. woff, NOT woff2: react-pdf supports only TTF/WOFF, and its fontkit's
// woff2/brotli decoder corrupts shared state when many woff2 fonts are decoded in
// one process, throwing DataView range errors at embed.

export const BUILT_IN_FONTS = ["Helvetica", "Times-Roman", "Courier"];

let registered = false;

export function registerDocumentFonts(): void {
  if (registered) return;
  registered = true;

  for (const { family, fonts } of BUNDLED_FONTS) {
    Font.register({ family, fonts });
  }
}

// Back-compat: routes await ensureFont(family) before render, but fonts are now all
// registered up front, so the arg is ignored.
export async function ensureFont(_family?: string): Promise<void> {
  registerDocumentFonts();
}

// Each bundled family's Central European glyphs (ś, ł, ő, č…) live in a separate
// "<family> Latin Ext" face (see scripts/generate-fonts.mjs).
const LATIN_EXT_SUFFIX = " Latin Ext";

// The font stack for a body font: react-pdf picks the first font with a glyph for
// each character, so "Przemyśl" draws "ś" from the Latin Ext face. Inter closes
// the stack because not every face covers Latin Ext (the built-in PDF fonts have
// none of it, Lato only a few letters). Only registered names enter the stack,
// and an unregistered family falls back to Helvetica, so react-pdf never throws
// "Font family not registered".
export function getSafeFontFamily(family: string | undefined | null): string[] {
  registerDocumentFonts();
  const registered = Font.getRegisteredFontFamilies();
  const base =
    family && (BUILT_IN_FONTS.includes(family) || registered.includes(family))
      ? family
      : "Helvetica";
  const fallbacks = [
    `${base}${LATIN_EXT_SUFFIX}`,
    "Inter",
    `Inter${LATIN_EXT_SUFFIX}`
  ].filter((name) => name !== base && registered.includes(name));
  return [base, ...new Set(fallbacks)];
}
