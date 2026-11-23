// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { I18n, Messages } from "@lingui/core";
import type { MetaArgs } from "react-router";
import { describe, expect, it } from "vitest";
import { moduleMeta, newRecordMeta, runtimeFor } from "./meta";

type Match = MetaArgs["matches"][number];

const match = (id: string, handle?: unknown, data?: unknown): Match =>
  ({
    id,
    pathname: "/",
    params: {},
    data,
    loaderData: data,
    meta: [],
    handle
  }) as Match;

// React Router calls a layout's meta with the matches up to the layout, then
// fills the same array with the deeper matches before rendering the title.
function renderTitle(matchesAtCall: Match[], deeper: Match[]) {
  const matches = [...matchesAtCall];
  const meta = moduleMeta("Sales")({
    matches,
    data: undefined,
    loaderData: undefined,
    params: {},
    location: {} as MetaArgs["location"]
  }) as { title: unknown }[];
  matches.push(...deeper);
  return String(meta[0]!.title);
}

describe("moduleMeta", () => {
  const root = match("root", undefined, { preferences: { locale: "en" } });
  const layout = match("sales", { breadcrumb: { id: "x", message: "Sales" } });

  it("names the page from the child route's breadcrumb, deepest first", () => {
    const orders = match("orders", {
      breadcrumb: { id: "y", message: "Orders" }
    });
    expect(renderTitle([root, layout], [orders])).toBe(
      "Orders | Sales | Carbon"
    );
  });

  it("reads breadcrumb functions with the route's data", () => {
    const record = match(
      "record",
      {
        breadcrumb: (_: unknown, data: { name: string }) => [
          { breadcrumb: { id: "z", message: "Customers" }, to: "/" },
          { breadcrumb: data.name }
        ]
      },
      { name: "Acme" }
    );
    expect(renderTitle([root, layout], [record])).toBe(
      "Acme | Customers | Sales | Carbon"
    );
  });

  it("falls back to the module title without breadcrumbs", () => {
    expect(renderTitle([root, match("sales")], [])).toBe("Carbon | Sales");
  });
});

describe("newRecordMeta", () => {
  it("names what is created, then the parents' trail, not the page's own list breadcrumb", () => {
    const matches = [
      match("root", undefined, { preferences: { locale: "en" } }),
      match("sales", { breadcrumb: { id: "x", message: "Sales" } }),
      match("new", { breadcrumb: { id: "y", message: "Orders" } })
    ];
    const meta = newRecordMeta("Sales Order")({
      matches,
      data: undefined,
      loaderData: undefined,
      params: {},
      location: {} as MetaArgs["location"]
    }) as { title: unknown }[];
    expect(meta[0]!.title).toBe("New Sales Order | Sales | Carbon");
  });
});

describe("runtimeFor", () => {
  it("reuses one runtime per language and loads the catalog when it arrives", () => {
    const runtimes = new Map<string, { catalog: Messages; i18n: I18n }>();
    // A language that has not loaded yet has a fresh, empty catalog on every
    // read, as `getCatalog` returns.
    const english = { title: "Orders" };
    expect(runtimeFor("en", english, runtimes)._("title")).toBe("Orders");

    // German is chosen but still loading: keep the English messages rather
    // than showing the hashed message id.
    const loading = runtimeFor("de", {}, runtimes);
    expect(loading._("title")).toBe("Orders");
    expect(runtimeFor("de", {}, runtimes)).toBe(loading);

    expect(runtimeFor("de", { title: "Aufträge" }, runtimes)._("title")).toBe(
      "Aufträge"
    );
    expect(runtimeFor("en", english, runtimes)._("title")).toBe("Orders");
  });
});
