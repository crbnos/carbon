// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  deferRootActionPost,
  isRootActionPost,
  isSearchParamOnlyNavigation,
  ROOT_ACTION_SAVE,
  rootShouldRevalidate
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
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "is false for a %s submission",
    (formMethod) => {
      expect(
        isSearchParamOnlyNavigation({
          currentUrl: url("/x/items/parts"),
          nextUrl: url("/x/items/parts"),
          formMethod
        })
      ).toBe(false);
    }
  );

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

describe("isRootActionPost", () => {
  it("is true for a post to the root action", () => {
    expect(isRootActionPost({ formAction: "/", formMethod: "POST" })).toBe(
      true
    );
  });

  it.each([
    { formAction: "/x/items", formMethod: "POST" },
    { formAction: "/", formMethod: "GET" },
    { formAction: undefined, formMethod: undefined }
  ])("is false for $formMethod $formAction", (args) => {
    expect(isRootActionPost(args)).toBe(false);
  });
});

// What React Router passes every route after an appearance save.
const appearanceSave = {
  currentUrl: url("/x/production"),
  nextUrl: url("/x/production"),
  formAction: ROOT_ACTION_SAVE.action,
  formMethod: ROOT_ACTION_SAVE.method.toUpperCase(),
  defaultShouldRevalidate: ROOT_ACTION_SAVE.defaultShouldRevalidate
};

describe("an appearance save", () => {
  it("re-runs the root loader", () => {
    expect(rootShouldRevalidate(appearanceSave)).toBe(true);
  });

  it("re-runs no route whose own rule re-runs after every post", () => {
    const afterEveryPost = deferRootActionPost(() => true);
    expect(afterEveryPost(appearanceSave)).toBe(false);
  });

  it("leaves other posts to the route's own rule", () => {
    const afterEveryPost = deferRootActionPost(() => true);
    expect(
      afterEveryPost({
        ...appearanceSave,
        formAction: "/x/sales/orders/new",
        defaultShouldRevalidate: true
      })
    ).toBe(true);
  });
});

describe("rootShouldRevalidate", () => {
  it("skips a same-page search-param change", () => {
    expect(
      rootShouldRevalidate({
        currentUrl: url("/x/items?page=1"),
        nextUrl: url("/x/items?page=2"),
        defaultShouldRevalidate: true
      })
    ).toBe(false);
  });

  it("follows the default for any other navigation or post", () => {
    expect(
      rootShouldRevalidate({
        currentUrl: url("/x/items"),
        nextUrl: url("/x/sales"),
        defaultShouldRevalidate: true
      })
    ).toBe(true);
  });
});
