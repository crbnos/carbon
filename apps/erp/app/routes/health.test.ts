import { redis } from "@carbon/kv";
import { describe, expect, it, vi } from "vitest";
import { loader } from "./health";

vi.mock("@carbon/kv", () => ({
  redis: { ping: vi.fn() }
}));

describe("health loader", () => {
  it("reports degraded/down when redis.ping resolves null", async () => {
    vi.mocked(redis.ping).mockResolvedValue(null as any);

    const response = await loader();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "degraded", redis: "down" });
  });

  it("reports healthy/up when redis.ping resolves PONG", async () => {
    vi.mocked(redis.ping).mockResolvedValue("PONG");

    const response = await loader();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "healthy", redis: "up" });
  });
});
