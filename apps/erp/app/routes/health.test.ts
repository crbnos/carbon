import { redis } from "@carbon/kv";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./health";

vi.mock("@carbon/kv", () => ({
  redis: { ping: vi.fn() }
}));

const select = vi.fn();

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => ({
    from: () => ({ select })
  })
}));

describe("health loader", () => {
  beforeEach(() => {
    // Default: every dependency healthy.
    vi.mocked(redis.ping).mockResolvedValue("PONG");
    select.mockResolvedValue({ error: null });
  });

  it("reports healthy when every dependency is up", async () => {
    const response = await loader();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "healthy",
      checks: {
        redis: "up",
        database: "up"
      }
    });
  });

  it("stays 200 but reports degraded when redis is down", async () => {
    vi.mocked(redis.ping).mockResolvedValue(null as any);

    const response = await loader();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.redis).toBe("down");
  });

  it("reports the database down (never throws) on a query error", async () => {
    select.mockResolvedValue({ error: { message: "boom" } });

    const response = await loader();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks.database).toBe("down");
  });
});
