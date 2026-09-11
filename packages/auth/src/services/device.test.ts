import { describe, expect, it, vi } from "vitest";

// Stub env so the cookie logic runs against the real react-router session
// storage only — mirrors destroy-session.test.ts.
vi.mock("../config/env", () => ({
  DOMAIN: "localhost",
  CarbonEdition: "Community",
  SESSION_SECRET: "test-session-secret"
}));

import { ensureDeviceId, getDeviceId } from "./device.server";

const request = (cookie?: string) =>
  new Request(
    "https://erp.example.com/callback",
    cookie ? { headers: { Cookie: cookie } } : undefined
  );

describe("device cookie", () => {
  it("mints a device id and returns a Set-Cookie when absent", async () => {
    const { deviceId, setCookie } = await ensureDeviceId(request());
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setCookie).toContain("carbon-device=");
  });

  it("reuses an existing device id and issues no new cookie", async () => {
    const first = await ensureDeviceId(request());
    const second = await ensureDeviceId(
      request(first.setCookie!.split(";")[0]!)
    );
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.setCookie).toBeUndefined();
  });

  it("treats a tampered cookie as no device", async () => {
    expect(
      await getDeviceId(request("carbon-device=garbage.notasignature"))
    ).toBeNull();
  });

  it("returns null when the cookie is absent", async () => {
    expect(await getDeviceId(request())).toBeNull();
  });
});
