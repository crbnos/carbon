// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSystemStatus } from "./system-status";

const respond = (body: unknown, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );

afterEach(() => vi.unstubAllGlobals());

describe("fetchSystemStatus", () => {
  it("fills in the announcement defaults", async () => {
    respond({
      latestVersion: "2026.10.1",
      announcement: { id: "a1", message: "Maintenance at 22:00 UTC" }
    });
    expect(await fetchSystemStatus("https://status.test")).toEqual({
      latestVersion: "2026.10.1",
      announcement: {
        id: "a1",
        message: "Maintenance at 22:00 UTC",
        severity: "info",
        dismissible: true
      }
    });
  });

  it("accepts a document with no announcement", async () => {
    respond({ announcement: null });
    expect(await fetchSystemStatus("https://status.test")).toEqual({
      announcement: null
    });
  });

  it("rejects a link that is not http(s)", async () => {
    respond({
      announcement: { id: "a1", message: "Hi", href: "javascript:alert(1)" }
    });
    expect(await fetchSystemStatus("https://status.test")).toBeNull();
  });

  it("returns null for an error status, a bad document or a dead host", async () => {
    respond({}, 500);
    expect(await fetchSystemStatus("https://status.test")).toBeNull();

    respond({ announcement: { message: "no id" } });
    expect(await fetchSystemStatus("https://status.test")).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );
    expect(await fetchSystemStatus("https://status.test")).toBeNull();
  });
});
