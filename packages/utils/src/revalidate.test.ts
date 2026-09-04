import { describe, expect, it } from "vitest";
import { isSearchParamOnlyNavigation } from "./revalidate";

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
