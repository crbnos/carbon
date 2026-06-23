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

// Falls back to Helvetica for an unregistered family so react-pdf never throws
// "Font family not registered".
export function getSafeFontFamily(family: string | undefined | null): string {
  registerDocumentFonts();
  if (!family) return "Helvetica";
  if (BUILT_IN_FONTS.includes(family)) return family;
  return Font.getRegisteredFontFamilies().includes(family)
    ? family
    : "Helvetica";
}
