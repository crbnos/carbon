// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  isMesLocale,
  MES_LOCALES,
  resolveMesLocale
} from "./locales";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Read the literal out of `lingui.config.js` rather than importing it: the file
 * is ESM and importing it would load `@lingui/cli` just to read an array.
 */
function linguiLocales(): string[] {
  const source = readFileSync(join(repoRoot, "lingui.config.js"), "utf8");
  const match = source.match(/locales:\s*\[([^\]]*)\]/);
  const list = match?.[1];
  if (!list) throw new Error("lingui.config.js has no `locales:` array");
  return [...list.matchAll(/"([a-z-]+)"/g)].flatMap((m) => m[1] ?? []);
}

describe("MES_LOCALES", () => {
  it("matches lingui.config.js exactly, in order", () => {
    expect(linguiLocales()).toEqual([...MES_LOCALES]);
  });

  it("includes the default locale", () => {
    expect(MES_LOCALES).toContain(DEFAULT_LOCALE);
  });
});

describe("resolveMesLocale", () => {
  it("takes the base subtag of a regional tag", () => {
    expect(resolveMesLocale("es-MX")).toBe("es");
    expect(resolveMesLocale("pt_BR")).toBe("pt");
    expect(resolveMesLocale("ZH-Hans")).toBe("zh");
  });

  it("falls back to en for an unsupported or missing tag", () => {
    expect(resolveMesLocale("sv")).toBe("en");
    expect(resolveMesLocale(null)).toBe("en");
    expect(resolveMesLocale("")).toBe("en");
  });

  it("narrows with isMesLocale", () => {
    expect(isMesLocale("de")).toBe(true);
    expect(isMesLocale("sv")).toBe(false);
    expect(isMesLocale(undefined)).toBe(false);
  });
});
