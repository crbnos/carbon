// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  boardSidebarCookie,
  isBoardSidebarShown,
  resolveModuleSidebar
} from "./moduleSidebar";

describe("resolveModuleSidebar", () => {
  it("always shows a list page's sidebar", () => {
    expect(resolveModuleSidebar([{}, { sidebar: "Inventory" }], false)).toEqual(
      { desktop: "Inventory", compact: "Inventory", isBoard: false }
    );
  });

  it("hides a board's desktop sidebar by default and keeps the phone switcher", () => {
    expect(
      resolveModuleSidebar([{}, { boardSidebar: "Production" }], false)
    ).toEqual({ desktop: undefined, compact: "Production", isBoard: true });
  });

  it("shows a board's desktop sidebar when the person chose to", () => {
    expect(
      resolveModuleSidebar([{}, { boardSidebar: "Production" }], true)
    ).toEqual({ desktop: "Production", compact: "Production", isBoard: true });
  });

  it("gives a phone-only switcher no desktop sidebar", () => {
    expect(
      resolveModuleSidebar([{ compactSidebar: "Settings" }], true)
    ).toEqual({ desktop: undefined, compact: "Settings", isBoard: false });
  });

  it("hides every sidebar on a route that hides the module sidebar", () => {
    expect(
      resolveModuleSidebar(
        [{ boardSidebar: "Production" }, { hideModuleSidebar: true }],
        true
      )
    ).toEqual({ desktop: undefined, compact: undefined, isBoard: false });
  });
});

describe("board sidebar cookie", () => {
  it("reads what it writes", () => {
    expect(isBoardSidebarShown(boardSidebarCookie(true))).toBe(true);
    expect(isBoardSidebarShown(boardSidebarCookie(false))).toBe(false);
  });

  it("treats no cookie, or any other value, as hidden", () => {
    expect(isBoardSidebarShown(null)).toBe(false);
    expect(isBoardSidebarShown("theme=zinc; boardSidebar=yes")).toBe(false);
    expect(isBoardSidebarShown("theme=zinc; boardSidebar=shown")).toBe(true);
  });
});
