import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./manifest";

const SERVICE_KEY = "test-service-role-key";

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
});

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.test/api/mcp/manifest", { headers });
}

describe("GET /api/mcp/manifest", () => {
  it("rejects requests without the service-role header", async () => {
    const res = await loader({
      request: req(),
      params: {},
      context: {} as never,
      unstable_pattern: "" as never
    });
    expect(res.status).toBe(401);
  });

  it("returns the manifest with ETag when authorized", async () => {
    const res = await loader({
      request: req({ "x-supabase-service-role": SERVICE_KEY }),
      params: {},
      context: {} as never,
      unstable_pattern: "" as never
    });
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    const body = await res.json();
    expect(body).toHaveProperty("contentHash");
    expect(body).toHaveProperty("tools");
  });

  it("returns 304 when If-None-Match matches the contentHash", async () => {
    const first = await loader({
      request: req({ "x-supabase-service-role": SERVICE_KEY }),
      params: {},
      context: {} as never,
      unstable_pattern: "" as never
    });
    const etag = first.headers.get("etag")!;
    const res = await loader({
      request: req({
        "x-supabase-service-role": SERVICE_KEY,
        "if-none-match": etag
      }),
      params: {},
      context: {} as never,
      unstable_pattern: "" as never
    });
    expect(res.status).toBe(304);
  });
});
