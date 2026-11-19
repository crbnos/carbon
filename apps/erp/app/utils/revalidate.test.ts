// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { revalidateIgnoringTabDisplay } from "./revalidate";

const check = (current: string, next: string, formMethod?: string) =>
  revalidateIgnoringTabDisplay({
    currentUrl: new URL(current, "https://example.com"),
    nextUrl: new URL(next, "https://example.com"),
    formMethod,
    defaultShouldRevalidate: true
  } as Parameters<typeof revalidateIgnoringTabDisplay>[0]);

it("skips loaders only for a tree/list display switch", () => {
  expect(check("/x/people/departments", "/x/people/departments?tab=list")).toBe(
    false
  );
  expect(check("/x/people/departments?tab=list", "/x/people/departments")).toBe(
    false
  );
  expect(
    check("/x/people/departments?tab=list", "/x/people/departments?tab=list")
  ).toBe(true);
  expect(
    check(
      "/x/people/departments?tab=list",
      "/x/people/departments?tab=tree&filter=active"
    )
  ).toBe(true);
  expect(
    check("/x/people/departments", "/x/people/departments?tab=list", "POST")
  ).toBe(true);
});
