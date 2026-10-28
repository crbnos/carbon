// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { pageBySlug } from "../content/registry";
import type { HubExclusions, Mod, PageDef } from "../types";
import {
  EMPTY_EXCLUSIONS,
  filterByModule,
  isModuleExcluded,
  isPageVisible,
  isSectionVisible
} from "./visibility";

const page = (slug: string) => {
  const found = pageBySlug(slug);
  if (!found) throw new Error(`no page ${slug}`);
  return found;
};

const excluding = (exclusions: Partial<HubExclusions>): HubExclusions => ({
  ...EMPTY_EXCLUSIONS,
  ...exclusions
});

describe("isModuleExcluded", () => {
  it("never hides an untagged node", () => {
    expect(isModuleExcluded(undefined, ["acc"])).toBe(false);
    expect(isModuleExcluded([], ["acc"])).toBe(false);
  });

  it("hides a node only when every one of its modules is excluded", () => {
    expect(isModuleExcluded(["acc"], ["acc"])).toBe(true);
    expect(isModuleExcluded(["acc", "inv"], ["acc"])).toBe(false);
    expect(isModuleExcluded(["acc", "inv"], ["acc", "inv"])).toBe(true);
  });

  it("hides nothing when no module is excluded", () => {
    expect(isModuleExcluded(["acc"], [])).toBe(false);
  });
});

describe("filterByModule", () => {
  const rows: { key: string; moduleTags?: Mod[] }[] = [
    { key: "untagged" },
    { key: "accounting", moduleTags: ["acc"] },
    { key: "shared", moduleTags: ["acc", "pur"] },
    { key: "quality", moduleTags: ["qms"] }
  ];

  it("drops the rows whose modules are all excluded, keeping order", () => {
    expect(filterByModule(rows, ["acc", "qms"]).map((r) => r.key)).toEqual([
      "untagged",
      "shared"
    ]);
  });

  it("keeps every row when nothing is excluded", () => {
    expect(filterByModule(rows, [])).toEqual(rows);
  });
});

describe("isPageVisible", () => {
  it("shows a Carbon-only page to staff and never to the customer", () => {
    const controls = page("controls");
    expect(controls.carbonOnly).toBe(true);
    expect(isPageVisible(controls, EMPTY_EXCLUSIONS, true, "self_serve")).toBe(
      true
    );
    expect(isPageVisible(controls, EMPTY_EXCLUSIONS, false, "self_serve")).toBe(
      false
    );
  });

  it("hides a paid-tier page on a self-serve hub", () => {
    const scope = page("scope");
    expect(isPageVisible(scope, EMPTY_EXCLUSIONS, false, "self_serve")).toBe(
      false
    );
    expect(isPageVisible(scope, EMPTY_EXCLUSIONS, false, "guided")).toBe(true);
    expect(isPageVisible(scope, EMPTY_EXCLUSIONS, false, "enterprise")).toBe(
      true
    );
  });

  it("does not filter by tier when the tier is unknown", () => {
    expect(isPageVisible(page("scope"), EMPTY_EXCLUSIONS, false)).toBe(true);
  });

  it("applies both the staff and the tier rule to a staff page", () => {
    const review = page("review");
    expect(isPageVisible(review, EMPTY_EXCLUSIONS, true, "guided")).toBe(true);
    expect(isPageVisible(review, EMPTY_EXCLUSIONS, true, "self_serve")).toBe(
      false
    );
  });

  it("shows an every-tier page on every tier", () => {
    for (const tier of ["self_serve", "guided", "enterprise"] as const) {
      expect(isPageVisible(page("setup"), EMPTY_EXCLUSIONS, false, tier)).toBe(
        true
      );
    }
  });

  it("hides a page excluded for this company, even from staff", () => {
    const exclusions = excluding({ pages: ["value"] });
    expect(isPageVisible(page("value"), exclusions, true, "guided")).toBe(
      false
    );
    expect(isPageVisible(page("plan"), exclusions, true, "guided")).toBe(true);
  });

  it("hides a page whose modules are all excluded", () => {
    const accountingPage: PageDef = {
      ...page("setup"),
      slug: "accounting-setup",
      moduleTags: ["acc"]
    };
    expect(
      isPageVisible(
        accountingPage,
        excluding({ modules: ["acc"] }),
        false,
        "guided"
      )
    ).toBe(false);
    expect(
      isPageVisible(
        accountingPage,
        excluding({ modules: ["inv"] }),
        false,
        "guided"
      )
    ).toBe(true);
  });
});

describe("isSectionVisible", () => {
  it("hides only the excluded sections", () => {
    const exclusions = excluding({ sections: ["risks"] });
    expect(isSectionVisible("risks", exclusions)).toBe(false);
    expect(isSectionVisible("issues", exclusions)).toBe(true);
  });
});
