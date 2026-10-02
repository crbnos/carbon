// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  isSearchParamOnlyNavigation,
  isUnaffectedByNavigation
} from "./revalidate";

const url = (href: string) => new URL(href, "https://erp.test");

describe("isSearchParamOnlyNavigation", () => {
  it("is true when only the search params changed", () => {
    expect(
      isSearchParamOnlyNavigation({
        currentUrl: url("/x/items/parts"),
        nextUrl: url("/x/items/parts?filter=active:eq:true")
      })
    ).toBe(true);
  });

  it("is true for paging within the same screen", () => {
    expect(
      isSearchParamOnlyNavigation({
        currentUrl: url("/x/items/parts?offset=0"),
        nextUrl: url("/x/items/parts?offset=100")
      })
    ).toBe(true);
  });

  it("is false when the pathname changed", () => {
    expect(
      isSearchParamOnlyNavigation({
        currentUrl: url("/x/items/parts"),
        nextUrl: url("/x/sales/orders")
      })
    ).toBe(false);
  });

  // A mutation may change shell data (saved views, company settings), so a
  // submission must always revalidate even when the URL is unchanged.
  it.each([
    "POST",
    "PUT",
    "PATCH",
    "DELETE"
  ])("is false for a %s submission", (formMethod) => {
    expect(
      isSearchParamOnlyNavigation({
        currentUrl: url("/x/items/parts"),
        nextUrl: url("/x/items/parts"),
        formMethod
      })
    ).toBe(false);
  });

  it("is true for a GET submission, which cannot mutate", () => {
    expect(
      isSearchParamOnlyNavigation({
        currentUrl: url("/x/items/parts"),
        nextUrl: url("/x/items/parts?search=bolt"),
        formMethod: "GET"
      })
    ).toBe(true);
  });

  it("treats an identical URL as search-param-only (revalidator case)", () => {
    expect(
      isSearchParamOnlyNavigation({
        currentUrl: url("/x/items/parts?a=1"),
        nextUrl: url("/x/items/parts?a=1")
      })
    ).toBe(true);
  });
});

describe("isUnaffectedByNavigation", () => {
  const nav = (
    from: string,
    to: string,
    itemIds: [string, string] = ["a", "a"],
    formMethod?: string
  ) =>
    isUnaffectedByNavigation(
      {
        currentUrl: url(from),
        nextUrl: url(to),
        currentParams: { itemId: itemIds[0] },
        nextParams: { itemId: itemIds[1] },
        formMethod
      },
      { params: ["itemId"], search: ["methodId"] }
    );

  it("is true when nothing the loader reads changed", () => {
    expect(nav("/x/part/a/details", "/x/part/a/planning")).toBe(true);
    expect(nav("/x/part/a/make/m1", "/x/part/a/make/m2?materialId=x")).toBe(
      true
    );
  });

  it("is false when a param or search param the loader reads changed", () => {
    expect(nav("/x/part/a/details", "/x/part/b/details", ["a", "b"])).toBe(
      false
    );
    expect(nav("/x/part/a/details", "/x/part/a/details?methodId=m")).toBe(
      false
    );
  });

  it("is false for a revalidation or a mutation", () => {
    expect(nav("/x/part/a/details", "/x/part/a/details")).toBe(false);
    expect(
      nav("/x/part/a/details", "/x/part/a/planning", ["a", "a"], "POST")
    ).toBe(false);
  });

  it('compares the whole query string with search "all"', () => {
    const list = (from: string, to: string) =>
      isUnaffectedByNavigation(
        {
          currentUrl: url(from),
          nextUrl: url(to),
          currentParams: {},
          nextParams: {}
        },
        { search: "all" }
      );
    expect(list("/x/items/parts?sort=a", "/x/items/parts/new?sort=a")).toBe(
      true
    );
    expect(list("/x/items/parts?sort=a", "/x/items/parts/new")).toBe(false);
  });
});
