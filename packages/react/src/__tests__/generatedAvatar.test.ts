// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { GENERATED_AVATAR_STYLES } from "@carbon/utils";
import { describe, expect, it, vi } from "vitest";
import {
  generatedAvatarDataUri,
  isDarkBackground,
  loadGeneratedAvatarStyle
} from "../utils/generatedAvatar";
import { generatedAvatarClassName } from "../utils/generatedAvatarImage";

const svgOf = (uri: string | undefined) =>
  decodeURIComponent((uri ?? "").replace(/^data:image\/svg\+xml;[^,]*,/, ""));

describe("generatedAvatarDataUri", () => {
  it("renders nothing until the value's style has loaded", async () => {
    // A fresh copy of the module, so no other test has loaded a style yet.
    vi.resetModules();
    const fresh = await import("../utils/generatedAvatar");
    const value = "dicebear:planets:seed-before-load";
    expect(fresh.generatedAvatarDataUri(value)).toBeUndefined();
    await fresh.loadGeneratedAvatarStyle("planets");
    expect(
      fresh.generatedAvatarDataUri(value)?.startsWith("data:image/svg+xml")
    ).toBe(true);
  });

  it.each(GENERATED_AVATAR_STYLES)("loads and renders %s", async (style) => {
    await loadGeneratedAvatarStyle(style);
    const uri = generatedAvatarDataUri(`dicebear:${style}:seed-one`);
    expect(uri?.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("is deterministic per seed and differs between seeds", async () => {
    await loadGeneratedAvatarStyle("croodles-neutral");
    const first = generatedAvatarDataUri("dicebear:croodles-neutral:seed-two");
    const again = generatedAvatarDataUri("dicebear:croodles-neutral:seed-two");
    const other = generatedAvatarDataUri(
      "dicebear:croodles-neutral:seed-three"
    );
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("differs between styles for the same seed", async () => {
    await loadGeneratedAvatarStyle("croodles-neutral");
    await loadGeneratedAvatarStyle("lorelei");
    expect(generatedAvatarDataUri("dicebear:lorelei:seed-two")).not.toBe(
      generatedAvatarDataUri("dicebear:croodles-neutral:seed-two")
    );
  });

  it("returns undefined for an uploaded photo path", () => {
    expect(
      generatedAvatarDataUri("5f0c3d2a-1b2c-4d5e-8f90-123456789abc.webp")
    ).toBeUndefined();
  });

  describe("background color", () => {
    it("paints the chosen background", async () => {
      await loadGeneratedAvatarStyle("voxel-art");
      const svg = svgOf(
        generatedAvatarDataUri("dicebear:voxel-art:seed-bg:3b82f6")
      );
      expect(svg.toLowerCase()).toContain("#3b82f6");
    });

    it("switches line ink to white on a dark background", async () => {
      await loadGeneratedAvatarStyle("croodles-neutral");
      const dark = svgOf(
        generatedAvatarDataUri("dicebear:croodles-neutral:seed-ink:111827")
      ).toLowerCase();
      const light = svgOf(
        generatedAvatarDataUri("dicebear:croodles-neutral:seed-ink:fde68a")
      ).toLowerCase();
      expect(dark).toContain("#ffffff");
      expect(light).toContain("#000000");
      expect(light).not.toContain("#ffffff");
    });

    it("classifies backgrounds by contrast", () => {
      expect(isDarkBackground("000000")).toBe(true);
      expect(isDarkBackground("1e3a8a")).toBe(true);
      expect(isDarkBackground("ffffff")).toBe(false);
      expect(isDarkBackground("ffd5dc")).toBe(false);
    });
  });

  describe("generatedAvatarClassName", () => {
    it("puts line-art styles on white in both themes", () => {
      for (const style of [
        "croodles-neutral",
        "notionists",
        "notionists-neutral",
        "lorelei",
        "lorelei-neutral"
      ] as const) {
        expect(generatedAvatarClassName(style)).toBe(
          "bg-white border-black/10"
        );
      }
    });

    it("leaves color styles on the muted background, never inverted", () => {
      for (const style of [
        "loops",
        "pixel-art",
        "voxel-art",
        "voxel-bot",
        "planets"
      ] as const) {
        const className = generatedAvatarClassName(style);
        expect(className).toBe("bg-muted border-transparent");
        expect(className).not.toContain("invert");
      }
    });
  });

  it("never passes import attributes to a style's import()", () => {
    // `import(x, { with: { type: "json" } })` makes the server route work but
    // the browser rejects it — Vite serves the JSON as JavaScript — and every
    // picker preview stayed grey. The server bundles @dicebear/styles instead
    // (`ssrNoExternal` in each app's vite.config.ts). See .ai/lessons.md.
    const source = readFileSync(
      new URL("../utils/generatedAvatar.ts", import.meta.url),
      "utf8"
    );
    const styleImports = source.match(
      /import\(\s*["']@dicebear\/styles\/[^)]*\)/g
    );
    expect(styleImports).toHaveLength(10);
    for (const call of styleImports ?? []) {
      expect(call).toMatch(/^import\(\s*["'][^"']+["']\s*\)$/);
    }
  });
});
