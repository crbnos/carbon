// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSpanName, redactedUrl } from "./tracing.server";

describe("redactedUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("removes the Inngest event key from the path", () => {
    expect(redactedUrl("https://inn.gs", "/e/secret-event-key")).toEqual({
      "url.full": "https://inn.gs/e/[REDACTED]",
      "url.path": "/e/[REDACTED]",
      "url.query": ""
    });
  });

  it("removes the key behind a configured base URL with a path prefix", () => {
    vi.stubEnv("INNGEST_EVENT_API_BASE_URL", "https://events.example.com/x/");
    expect(
      redactedUrl("https://events.example.com", "/x/e/secret-event-key")
    ).toEqual({
      "url.full": "https://events.example.com/x/e/[REDACTED]",
      "url.path": "/x/e/[REDACTED]",
      "url.query": ""
    });
  });

  it("leaves other hosts' paths alone and still redacts the query", () => {
    expect(
      redactedUrl("https://api.example.com", "/e/thing?token=abc&page=2")
    ).toEqual({
      "url.full": "https://api.example.com/e/thing?token=%5BREDACTED%5D&page=2",
      "url.path": "/e/thing",
      "url.query": "?token=%5BREDACTED%5D&page=2"
    });
  });
});

describe("fetchSpanName", () => {
  const supabase = "https://api.example.com";

  it.each([
    ["GET", "/rest/v1/item?select=*", "GET /rest/v1/item"],
    [
      "POST",
      "/rest/v1/rpc/get_part_details",
      "POST /rest/v1/rpc/get_part_details"
    ],
    ["GET", "/storage/v1/object/co_123/parts/a.png", "storage download"],
    [
      "GET",
      "/storage/v1/object/authenticated/co_123/a.png",
      "storage download"
    ],
    ["POST", "/storage/v1/object/co_123/parts/a.png", "storage upload"],
    ["HEAD", "/storage/v1/object/co_123/a.png", "storage exists"],
    ["DELETE", "/storage/v1/object/co_123", "storage delete"],
    ["POST", "/storage/v1/object/list-v2/co_123", "storage list"],
    ["POST", "/storage/v1/object/sign/co_123/a.png", "storage sign"],
    ["POST", "/storage/v1/object/move", "storage move"],
    [
      "GET",
      "/storage/v1/render/image/authenticated/co_123/a.png",
      "storage transform"
    ],
    ["GET", "/auth/v1/user", "auth GET user"],
    ["POST", "/auth/v1/token?grant_type=refresh_token", "auth POST token"],
    [
      "PUT",
      "/auth/v1/admin/users/0b6e2c1a-1111-4222-8333-444455556666",
      "auth PUT admin/users"
    ],
    ["POST", "/functions/v1/get-method", "function get-method"]
  ])("%s %s is %s", (method, path, name) => {
    expect(fetchSpanName(method, supabase, path)).toBe(name);
  });

  it("names any other call by host", () => {
    expect(
      fetchSpanName("GET", "https://api.xero.com", "/api.xro/2.0/Invoices/abc")
    ).toBe("GET api.xero.com");
  });
});
