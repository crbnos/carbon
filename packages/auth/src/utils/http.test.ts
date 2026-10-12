// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { safePath } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { getCurrentPath, makeRedirectToFromHere } from "./http";

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

    expect(safePath(login.searchParams.get("redirectTo"), "/x")).toBe(
      emailLink
    );
  });
});
