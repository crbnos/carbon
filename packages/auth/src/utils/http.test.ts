// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { getCurrentPath, makeRedirectToFromHere, safeRedirect } from "./http";

// The link a notification email carries (see buildNotificationLink).
const emailLink =
  "/api/link?event=approval-requested&documentId=po_1&companyId=co_1&documentType=purchaseOrder";

describe("getCurrentPath", () => {
  it("keeps the query string", () => {
    expect(
      getCurrentPath(new Request(`https://app.carbon.ms${emailLink}`))
    ).toBe(emailLink);
  });

  it("returns a bare path unchanged", () => {
    expect(getCurrentPath(new Request("https://app.carbon.ms/x/parts"))).toBe(
      "/x/parts"
    );
  });

  it("leaves a query without the single-fetch param byte for byte", () => {
    const filtered = "/x/parts?filter=status:in:[open,late]&index";

    expect(
      getCurrentPath(new Request(`https://app.carbon.ms${filtered}`))
    ).toBe(filtered);
  });

  it("drops React Router's single-fetch param", () => {
    expect(
      getCurrentPath(
        new Request("https://app.carbon.ms/x/parts?tab=open&_routes=root")
      )
    ).toBe("/x/parts?tab=open");
  });
});

describe("makeRedirectToFromHere", () => {
  it("round-trips a URL with a query string through redirectTo", () => {
    const params = makeRedirectToFromHere(
      new Request(`https://app.carbon.ms${emailLink}`)
    );
    const login = new URL(`https://app.carbon.ms/login?${params}`);

    expect(safeRedirect(login.searchParams.get("redirectTo"), "/x")).toBe(
      emailLink
    );
  });
});

describe("safeRedirect", () => {
  it("keeps a same-origin path", () => {
    expect(safeRedirect("/x/sales/orders?tab=open", "/x")).toBe(
      "/x/sales/orders?tab=open"
    );
  });

  it.each([
    ["an absolute URL", "https://evil.com"],
    ["a protocol-relative URL", "//evil.com"],
    ["a backslash host", "/\\evil.com"],
    ["a relative path", "x/sales"],
    ["an empty value", ""],
    ["no value", null]
  ])("falls back for %s", (_label, to) => {
    expect(safeRedirect(to, "/x")).toBe("/x");
  });
});
