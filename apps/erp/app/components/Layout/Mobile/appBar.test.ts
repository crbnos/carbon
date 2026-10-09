// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { deriveAppBar, mergeAppBar } from "./appBar";

describe("deriveAppBar", () => {
  it("treats a module sidebar section as root", () => {
    expect(
      deriveAppBar(
        [
          { breadcrumb: "Purchasing", to: "/x/purchasing" },
          { breadcrumb: "Orders", to: "/x/purchasing/orders" }
        ],
        { hasModuleSidebar: true, moduleCrumbIndex: 0 }
      )
    ).toEqual({ title: "Orders", kind: "root" });
  });

  it("pushes a record page and goes up to its list", () => {
    expect(
      deriveAppBar(
        [
          { breadcrumb: "Purchasing", to: "/x/purchasing" },
          { breadcrumb: "Orders", to: "/x/purchasing/orders" },
          { breadcrumb: "PO000018" }
        ],
        { hasModuleSidebar: false, moduleCrumbIndex: 0 }
      )
    ).toEqual({
      title: "PO000018",
      subtitle: "Orders",
      backTo: "/x/purchasing/orders",
      kind: "pushed"
    });
  });

  it("treats a settings page as root", () => {
    expect(
      deriveAppBar(
        [
          { breadcrumb: "Settings", to: "/x/settings" },
          { breadcrumb: "Company", to: "/x/settings/company" }
        ],
        { hasModuleSidebar: true, moduleCrumbIndex: 0 }
      ).kind
    ).toBe("root");
  });

  it("pushes a page two crumbs below the module even with a sidebar", () => {
    expect(
      deriveAppBar(
        [
          { breadcrumb: "Inventory", to: "/x/inventory" },
          { breadcrumb: "Quantities", to: "/x/inventory/quantities" },
          { breadcrumb: "ITEM-1" }
        ],
        { hasModuleSidebar: true, moduleCrumbIndex: 0 }
      ).kind
    ).toBe("pushed");
  });

  it("treats Home as root", () => {
    expect(
      deriveAppBar([], { hasModuleSidebar: false, moduleCrumbIndex: 0 })
    ).toEqual({ title: null, kind: "root" });
  });
});

describe("mergeAppBar", () => {
  const root = { title: "Customers", kind: "root" as const };
  const pushed = {
    title: "PO000018",
    subtitle: "Orders",
    backTo: "/x/purchasing/orders",
    kind: "pushed" as const
  };

  it("returns the derived bar without an override", () => {
    expect(mergeAppBar(pushed, null)).toEqual(pushed);
  });

  it("pushes a root screen with Back from the override", () => {
    expect(
      mergeAppBar(root, { kind: "pushed", backTo: "/x/sales/customers" })
    ).toEqual({
      title: "Customers",
      subtitle: undefined,
      kind: "pushed",
      backTo: "/x/sales/customers"
    });
  });

  it("keeps the derived title in selection mode when none is given", () => {
    expect(mergeAppBar(root, { kind: "selection" }).title).toBe("Customers");
  });

  it("drops the derived subtitle under an override", () => {
    expect(
      mergeAppBar(pushed, { kind: "selection", title: "2 selected" }).subtitle
    ).toBeUndefined();
  });
});
