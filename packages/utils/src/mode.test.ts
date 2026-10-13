// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  COLOR_SCHEME_HINT_COOKIE,
  colorSchemeHintScript,
  getModeFromCookies,
  MODE_COOKIE
} from "./mode";

describe("getModeFromCookies", () => {
  it("defaults to system, rendered light, with no cookies", () => {
    expect(getModeFromCookies(null)).toEqual({
      mode: "light",
      modePreference: "system"
    });
  });

  it("renders a system user in the OS mode the browser reported", () => {
    expect(getModeFromCookies(`${COLOR_SCHEME_HINT_COOKIE}=dark`)).toEqual({
      mode: "dark",
      modePreference: "system"
    });
  });

  it("lets an explicit choice win over the OS", () => {
    expect(
      getModeFromCookies(
        `${MODE_COOKIE}=light; ${COLOR_SCHEME_HINT_COOKIE}=dark`
      )
    ).toEqual({ mode: "light", modePreference: "light" });
  });

  it("treats an unknown mode cookie as system", () => {
    expect(
      getModeFromCookies(
        `${MODE_COOKIE}=blue; ${COLOR_SCHEME_HINT_COOKIE}=dark`
      )
    ).toEqual({ mode: "dark", modePreference: "system" });
  });
});

/** Runs the inline script against a fake browser; returns whether it reloaded. */
function runHintScript({
  cookies,
  osDark,
  cookiesWritable = true
}: {
  cookies: string;
  osDark: boolean;
  cookiesWritable?: boolean;
}) {
  let jar = cookies;
  let reloaded = false;
  const document = {
    get cookie() {
      return jar;
    },
    set cookie(value: string) {
      if (!cookiesWritable) return;
      const pair = value.split(";")[0]!;
      const name = pair.split("=")[0]!;
      const rest = jar
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c && !c.startsWith(`${name}=`));
      jar = [...rest, pair].join("; ");
    },
    documentElement: { style: {} as Record<string, string> }
  };
  const window = {
    matchMedia: () => ({ matches: osDark }),
    location: {
      reload: () => {
        reloaded = true;
      }
    }
  };
  const navigator = { cookieEnabled: true };
  new Function("window", "document", "navigator", colorSchemeHintScript)(
    window,
    document,
    navigator
  );
  return { reloaded, cookies: jar };
}

describe("colorSchemeHintScript", () => {
  it("reloads a system user whose page was rendered light on a dark OS", () => {
    const result = runHintScript({ cookies: "", osDark: true });
    expect(result.reloaded).toBe(true);
    expect(result.cookies).toContain(`${COLOR_SCHEME_HINT_COOKIE}=dark`);
  });

  it("does not reload when the server's light fallback was right", () => {
    const result = runHintScript({ cookies: "", osDark: false });
    expect(result.reloaded).toBe(false);
    expect(result.cookies).toContain(`${COLOR_SCHEME_HINT_COOKIE}=light`);
  });

  it("reloads a system user when the OS changed since the last visit", () => {
    expect(
      runHintScript({
        cookies: `${COLOR_SCHEME_HINT_COOKIE}=dark`,
        osDark: false
      }).reloaded
    ).toBe(true);
  });

  it("does nothing when the hint is current", () => {
    expect(
      runHintScript({
        cookies: `${COLOR_SCHEME_HINT_COOKIE}=dark`,
        osDark: true
      }).reloaded
    ).toBe(false);
  });

  it("records the hint but never reloads an explicit choice", () => {
    const result = runHintScript({
      cookies: `${MODE_COOKIE}=light`,
      osDark: true
    });
    expect(result.reloaded).toBe(false);
    expect(result.cookies).toContain(`${COLOR_SCHEME_HINT_COOKIE}=dark`);
  });

  it("never reloads when the cookie cannot be written", () => {
    expect(
      runHintScript({ cookies: "", osDark: true, cookiesWritable: false })
        .reloaded
    ).toBe(false);
  });
});
