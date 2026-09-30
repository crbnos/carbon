import { describe, expect, it } from "vitest";
import { isFresh, resolveOnshapeRefresh } from "./token-refresh";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const inMinutes = (minutes: number) =>
  new Date(NOW + minutes * 60_000).toISOString();

describe("isFresh", () => {
  it("treats a token inside the two-minute margin as expired", () => {
    expect(isFresh({ expiresAt: inMinutes(1) }, NOW)).toBe(false);
    expect(isFresh({ expiresAt: inMinutes(5) }, NOW)).toBe(true);
  });

  it("treats a missing expiry as expired, so an old install still refreshes", () => {
    expect(isFresh({}, NOW)).toBe(false);
  });
});

describe("resolveOnshapeRefresh", () => {
  const requestCopy = {
    accessToken: "loaded-access",
    refreshToken: "loaded-refresh",
    expiresAt: inMinutes(-10)
  };

  it("adopts a live pair another caller stored", () => {
    const stored = {
      accessToken: "newer-access",
      refreshToken: "newer-refresh",
      expiresAt: inMinutes(60)
    };
    expect(
      resolveOnshapeRefresh(stored, requestCopy, "loaded-access", NOW)
    ).toEqual({ action: "adopt", credentials: stored });
  });

  it("spends the stored refresh token, not the one this request loaded", () => {
    const stored = {
      accessToken: "newer-access",
      refreshToken: "newer-refresh",
      expiresAt: inMinutes(-1)
    };
    expect(
      resolveOnshapeRefresh(stored, requestCopy, "loaded-access", NOW)
    ).toEqual({ action: "exchange", credentials: stored });
  });

  it("refreshes after a 401 even when the rejected token looks unexpired", () => {
    const stored = { ...requestCopy, expiresAt: inMinutes(60) };
    expect(
      resolveOnshapeRefresh(stored, requestCopy, "loaded-access", NOW).action
    ).toBe("exchange");
  });

  it("falls back to this request's copy only when the row could not be read", () => {
    expect(
      resolveOnshapeRefresh(null, requestCopy, "loaded-access", NOW)
    ).toEqual({ action: "exchange", credentials: requestCopy });
  });
});
