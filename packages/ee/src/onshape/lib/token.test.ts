import { describe, expect, it } from "vitest";
import { onshapeTokenExpiresAt } from "./token";

describe("onshapeTokenExpiresAt", () => {
  const secondsUntil = (iso: string) =>
    Math.round((new Date(iso).getTime() - Date.now()) / 1000);

  it("honours Onshape's own lifetime rather than assuming an hour", () => {
    // The bug this replaces: both write sites stored now + 3600s and discarded
    // expires_in. A shorter real lifetime made the stored value a lie in the
    // dangerous direction — the token died, Carbon still believed it valid,
    // never refreshed, and every call 401'd with invalid_token until the
    // fictional hour was up.
    expect(secondsUntil(onshapeTokenExpiresAt(600))).toBeLessThan(600);
    expect(secondsUntil(onshapeTokenExpiresAt(600))).toBeGreaterThan(400);
  });

  it("refreshes early by a margin, so a call starting near the boundary is safe", () => {
    // Expiry is checked at the START of a call; a token with four seconds left
    // passes the check and is dead by the time the request lands.
    expect(secondsUntil(onshapeTokenExpiresAt(3600))).toBeLessThan(3600);
  });

  it("falls back to an hour when Onshape sends no expires_in", () => {
    expect(secondsUntil(onshapeTokenExpiresAt())).toBeGreaterThan(3000);
    expect(secondsUntil(onshapeTokenExpiresAt(undefined))).toBeGreaterThan(
      3000
    );
  });

  it("never returns a moment already in the past", () => {
    // A lifetime shorter than the margin would otherwise produce an expiry
    // behind us, which reads as "always expired" and refreshes on every call.
    for (const lifetime of [0, 1, 30, 119, 120]) {
      expect(secondsUntil(onshapeTokenExpiresAt(lifetime))).toBeGreaterThan(0);
    }
  });

  it("ignores a nonsense expires_in rather than trusting it", () => {
    expect(secondsUntil(onshapeTokenExpiresAt(Number.NaN))).toBeGreaterThan(
      3000
    );
    expect(
      secondsUntil(onshapeTokenExpiresAt(Number.POSITIVE_INFINITY))
    ).toBeGreaterThan(3000);
  });
});
