// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/env", () => ({ getAppUrl: () => "https://erp.test" }));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn() })
}));

const { proxyToErp } = await import("./erp-proxy.server");

const fetchMock = vi.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response("ok", { status: 200 })
);

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const request = (search = "") =>
  new Request(`https://mes.test/x/proxy/anything${search}`);

describe("proxyToErp", () => {
  it("forwards an ERP API path with its query", async () => {
    const response = await proxyToErp(request("?a=1"), "api/account/profile");
    expect(response.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://erp.test/api/account/profile?a=1"
    );
  });

  it.each([
    ["an ERP page", "x/sales/quotes"],
    ["an ERP action", "x/settings/company/new"],
    ["no path", undefined],
    ["a climb out of the API", "api/../x/settings/company/new"],
    ["an encoded climb", "api/%2e%2e/x/settings"],
    ["another host", "//evil.test/api/steal"],
    ["an absolute URL", "https://evil.test/api/steal"]
  ])("refuses %s without calling the ERP", async (_, path) => {
    const response = await proxyToErp(request(), path);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
