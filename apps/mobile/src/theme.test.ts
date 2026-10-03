// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * global.css copies Carbon's default web theme ("zinc" / "Modern" in
 * packages/utils/src/themes.ts) because Uniwind cannot consume
 * packages/config/tailwind/theme.css directly. This test is what keeps the copy
 * honest: change a token on the web and this fails until the app follows.
 *
 * Both files are read as TEXT. themes.ts imports lodash.template, which this app
 * does not install, and theme.css is not valid TS — so neither can be imported.
 */
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "../..");

/** The body of `name: "<theme>"`'s `cssVars.<mode>` object, brace-matched. */
function webThemeTokens(theme: string, mode: "light" | "dark") {
  const source = readFileSync(
    join(repoRoot, "packages/utils/src/themes.ts"),
    "utf8"
  );
  const themeStart = source.indexOf(`name: "${theme}"`);
  if (themeStart === -1) throw new Error(`themes.ts has no "${theme}" theme`);
  const nextTheme = source.indexOf('name: "', themeStart + 10);
  const block = source.slice(
    themeStart,
    nextTheme === -1 ? undefined : nextTheme
  );

  const modeStart = block.indexOf(`${mode}: {`);
  if (modeStart === -1) {
    throw new Error(`"${theme}" has no ${mode} cssVars`);
  }
  let depth = 0;
  let end = modeStart;
  for (let i = block.indexOf("{", modeStart); i < block.length; i++) {
    if (block[i] === "{") depth++;
    if (block[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = block.slice(modeStart, end);

  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/"?([a-z-]+)"?:\s*"([^"]+)"/g)) {
    const key = m[1];
    const value = m[2];
    if (key && value && key !== mode) tokens[key] = value;
  }
  return tokens;
}

/** The raw hsl triples declared under a selector in the app's global.css. */
function appTokens(selector: string) {
  const css = readFileSync(join(appRoot, "global.css"), "utf8");
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`global.css has no \`${selector}\` block`);
  const end = css.indexOf("}", start);
  const body = css.slice(start, end);

  const tokens: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    const key = m[1];
    const value = m[2];
    if (key && value) tokens[key] = value.trim();
  }
  return tokens;
}

// Every token the app declares and shares with the web theme. `radius` is the
// app's own (the web derives it per theme), so it is not compared.
const SHARED = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "success",
  "success-foreground"
] as const;

describe.each([
  ["light", ":root"],
  ["dark", ":root:where(.dark, .dark *)"]
] as const)("%s tokens match the web zinc theme", (mode, selector) => {
  const web = webThemeTokens("zinc", mode);
  const app = appTokens(selector);

  it("parsed both sides", () => {
    expect(Object.keys(web).length).toBeGreaterThan(15);
    expect(Object.keys(app).length).toBeGreaterThan(15);
  });

  it.each(SHARED)("%s", (token) => {
    expect(app[token], `global.css ${selector} is missing --${token}`).toBe(
      web[token]
    );
  });
});

describe("global.css shape", () => {
  const css = readFileSync(join(appRoot, "global.css"), "utf8");

  it("declares the dark theme on a .dark root selector", () => {
    // Uniwind matches a registered theme by class selector on :root
    // (src/bundler/css-visitor/rule-visitor.ts). A media query would not work.
    expect(css).toContain(":root:where(.dark, .dark *)");
    expect(css).toContain("@custom-variant dark");
  });

  it("maps every raw token into a Tailwind color via @theme inline", () => {
    for (const token of SHARED) {
      expect(css).toContain(`--color-${token}: hsl(var(--${token}))`);
    }
  });
});
