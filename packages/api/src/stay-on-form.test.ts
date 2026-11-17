// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { staysOnForm } from "./stay-on-form";

const request = (url: string, method: string, referer?: string) =>
  new Request(url, {
    method,
    headers: referer ? { Referer: referer } : undefined
  });

describe("staysOnForm", () => {
  it("stays for a POST from the page that owns the action", () => {
    expect(
      staysOnForm(
        request(
          "https://erp.test/x/part/new",
          "POST",
          "https://erp.test/x/part/new?type=Part"
        )
      )
    ).toBe(true);
  });

  it("stays for a single-fetch data request from that page", () => {
    expect(
      staysOnForm(
        request(
          "https://erp.test/x/part/new.data",
          "POST",
          "https://erp.test/x/part/new"
        )
      )
    ).toBe(true);
  });

  it("goes back for a POST to an action-only route from another page", () => {
    expect(
      staysOnForm(
        request(
          "https://erp.test/x/receipt/new",
          "POST",
          "https://erp.test/x/purchase-order/po_1/details"
        )
      )
    ).toBe(false);
  });

  it("goes back for a loader and when the page is not known", () => {
    expect(
      staysOnForm(
        request(
          "https://erp.test/x/part/new",
          "GET",
          "https://erp.test/x/part/new"
        )
      )
    ).toBe(false);
    expect(staysOnForm(request("https://erp.test/x/part/new", "POST"))).toBe(
      false
    );
  });
});
