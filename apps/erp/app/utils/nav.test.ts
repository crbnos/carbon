// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  gateOfRoute,
  moduleLanding,
  moduleOfMatches,
  routeOwnsUrl,
  visibleGroups
} from "./nav";

const none = { view: [], create: [], update: [], delete: [] };
const viewing = (...pages: string[]) =>
  Object.fromEntries(pages.map((page) => [page, { ...none, view: ["c1"] }]));

describe("gateOfRoute", () => {
  it("shows an entry behind View on its page, its own gate, or nothing", () => {
    expect(gateOfRoute({ to: "/x/sales/quotes" })).toEqual({
      "sales.quotes": "View"
    });
    expect(
      gateOfRoute({
        to: "/x/projects/issue",
        gate: { "inventory.quantities": "Edit" }
      })
    ).toEqual({ "inventory.quantities": "Edit" });
    expect(gateOfRoute({ to: "/x/timesheet" })).toEqual({});
  });
});

describe("routeOwnsUrl", () => {
  const projects = { to: "/x/projects" };
  const approvals = { to: "/x/projects/approvals" };
  const reports = { to: "/x/projects/reports" };
  const siblings = [projects, approvals, reports];

  it("lights the entry of the page the URL belongs to, records included", () => {
    expect(routeOwnsUrl(projects, "/x/project/p1/details", siblings)).toBe(
      true
    );
    expect(routeOwnsUrl(projects, "/x/projects/reports/x", siblings)).toBe(
      false
    );
    expect(routeOwnsUrl(reports, "/x/projects/reports/x", siblings)).toBe(true);
    expect(routeOwnsUrl(approvals, "/x/projects/billing", siblings)).toBe(true);
  });

  it("prefers the sibling whose `to` the URL starts with, longest first", () => {
    const accounts = { to: "/x/users/employees" };
    const customers = { to: "/x/users/customers", page: undefined };
    const group = [accounts, customers];
    expect(routeOwnsUrl(accounts, "/x/users/customers", group)).toBe(false);
    expect(routeOwnsUrl(customers, "/x/users/customers", group)).toBe(true);
    expect(routeOwnsUrl(accounts, "/x/users/employees/u1", group)).toBe(true);
  });

  it("matches an entry with no page by its `to`", () => {
    expect(routeOwnsUrl({ to: "/x/timesheet" }, "/x/timesheet/review")).toBe(
      true
    );
  });
});

describe("visibleGroups", () => {
  const permissions = (...pages: string[]) => ({
    has: (gate: object) =>
      Object.keys(gate).every((page) => pages.includes(page))
  });
  const groups = [
    {
      name: "Quoting",
      routes: [{ to: "/x/sales/quotes" }, { to: "/x/sales/rfqs" }]
    },
    { name: "Configure", routes: [{ to: "/x/sales/customer-statuses" }] }
  ];

  it("keeps the entries whose gate holds, and drops an empty group", () => {
    expect(visibleGroups(groups, permissions("sales.quotes"))).toEqual([
      { name: "Quoting", routes: [{ to: "/x/sales/quotes" }] }
    ]);
  });

  it("applies the extra rule", () => {
    expect(
      visibleGroups(
        groups,
        permissions("sales.quotes", "sales.statuses"),
        (route) => route.to !== "/x/sales/customer-statuses"
      )
    ).toEqual([{ name: "Quoting", routes: [{ to: "/x/sales/quotes" }] }]);
  });
});

describe("moduleLanding", () => {
  it("opens a module on the first page the person can view", () => {
    expect(moduleLanding("parts", viewing("parts.tools"), "c1")).toBe(
      "/x/items/tools"
    );
    expect(moduleLanding("parts", {}, "c1")).toBeUndefined();
  });

  it("opens Settings on Company when the person can view it", () => {
    expect(
      moduleLanding(
        "settings",
        viewing("settings.billing", "settings.company"),
        "c1"
      )
    ).toBe("/x/settings/company");
    expect(moduleLanding("settings", viewing("settings.billing"), "c1")).toBe(
      "/x/settings/billing"
    );
  });
});

describe("moduleOfMatches", () => {
  const x = { pathname: "/x" };
  const layout = (pathname: string, module: string) => ({
    pathname,
    handle: { module }
  });

  it("takes the module of the page the URL belongs to", () => {
    expect(
      moduleOfMatches([
        x,
        { pathname: "/x/service-job" },
        { pathname: "/x/service-job/SJ1" }
      ])
    ).toBe("service");
    expect(moduleOfMatches([x, { pathname: "/x/customer-asset/A1" }])).toBe(
      "service"
    );
    expect(moduleOfMatches([x, { pathname: "/x/sales-invoice/new" }])).toBe(
      "invoicing"
    );
  });

  it("keeps a record's tab in the record's module", () => {
    expect(
      moduleOfMatches([
        x,
        { pathname: "/x/customer" },
        { pathname: "/x/customer/C1" },
        { pathname: "/x/customer/C1/bank-accounts" }
      ])
    ).toBe("sales");
  });

  it("takes a module layout's handle before the page below it", () => {
    expect(
      moduleOfMatches([
        x,
        layout("/x/accounting", "accounting"),
        { pathname: "/x/accounting/activation" }
      ])
    ).toBe("accounting");
    expect(moduleOfMatches([x, layout("/x/sales", "sales")])).toBe("sales");
    expect(moduleOfMatches([x, layout("/x/credits", "invoicing")])).toBe(
      "invoicing"
    );
    expect(moduleOfMatches([x, { pathname: "/x/timesheet" }])).toBeUndefined();
  });
});
