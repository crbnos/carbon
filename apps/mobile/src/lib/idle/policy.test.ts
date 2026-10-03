// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { MeResponse } from "@carbon/mes-core";
import { describe, expect, it } from "vitest";
import { analyticsDecision } from "../analytics/policy";
import { idleAction, isIdle } from "./policy";

/**
 * Two policies whose failure modes are the ones that matter most in this app:
 * telemetry leaving a controlled environment, and an operator's name still
 * attached to a tablet they walked away from.
 */

const me = (over: {
  mode?: "connected" | "airgapped";
  controlledEnvironment?: boolean;
  analytics?: { posthogKey: string; posthogHost: string } | null;
}): MeResponse =>
  ({
    instance: {
      name: "Carbon",
      supabaseUrl: "https://example.test",
      supabaseAnonKey: "k",
      mode: over.mode ?? "connected",
      controlledEnvironment: over.controlledEnvironment ?? false,
      idleLockMs: 0,
      minAppVersion: "1.0.0",
      analytics:
        over.analytics === undefined
          ? { posthogKey: "phc_1", posthogHost: "https://ph.test" }
          : over.analytics
    }
  }) as MeResponse;

describe("analyticsDecision", () => {
  it("is on only for a connected, uncontrolled, configured instance", () => {
    const decision = analyticsDecision(me({}));
    expect(decision).toEqual({
      enabled: true,
      apiKey: "phc_1",
      host: "https://ph.test"
    });
  });

  it("is off before sign-in", () => {
    // Nothing may leave the device before /me has said where it may go.
    expect(analyticsDecision(null)).toEqual({
      enabled: false,
      reason: "not_signed_in"
    });
    expect(analyticsDecision(undefined).enabled).toBe(false);
  });

  it("is off when air-gapped, EVEN IF the server sends a key", () => {
    // The redundancy is the point: one misconfigured server must not be able
    // to turn telemetry on in an air-gapped plant.
    expect(analyticsDecision(me({ mode: "airgapped" }))).toEqual({
      enabled: false,
      reason: "airgapped"
    });
  });

  it("is off in a controlled environment, EVEN IF the server sends a key", () => {
    expect(analyticsDecision(me({ controlledEnvironment: true }))).toEqual({
      enabled: false,
      reason: "controlled_environment"
    });
  });

  it("is off when the instance configured nothing", () => {
    expect(analyticsDecision(me({ analytics: null }))).toEqual({
      enabled: false,
      reason: "not_configured"
    });
    // A half-filled config is not a config.
    expect(
      analyticsDecision(
        me({ analytics: { posthogKey: "", posthogHost: "https://ph.test" } })
      ).enabled
    ).toBe(false);
  });
});

describe("idleAction", () => {
  it("pins the operator out of a shared terminal", () => {
    // The whole reason operator attribution exists: the next person's work
    // must not be credited to whoever walked away.
    expect(
      idleAction({
        idleLockMs: 60_000,
        controlledEnvironment: false,
        hasOperator: true
      })
    ).toBe("pin_out");
  });

  it("prefers pinning out over signing out when both could apply", () => {
    // A shared tablet should stay signed in and ready for the next operator.
    expect(
      idleAction({
        idleLockMs: 60_000,
        controlledEnvironment: true,
        hasOperator: true
      })
    ).toBe("pin_out");
  });

  it("signs out a controlled-environment device with nobody pinned in", () => {
    expect(
      idleAction({
        idleLockMs: 60_000,
        controlledEnvironment: true,
        hasOperator: false
      })
    ).toBe("sign_out");
  });

  it("does nothing on an ordinary personal device", () => {
    // Signing someone out of their own phone because they took a call is
    // hostile; idleLockMs is a policy about shared and controlled hardware.
    expect(
      idleAction({
        idleLockMs: 60_000,
        controlledEnvironment: false,
        hasOperator: false
      })
    ).toBe("none");
  });

  it("does nothing when the instance sets no limit", () => {
    for (const idleLockMs of [0, null, undefined, -1, Number.NaN]) {
      expect(
        idleAction({
          idleLockMs,
          controlledEnvironment: true,
          hasOperator: true
        })
      ).toBe("none");
    }
  });
});

describe("isIdle", () => {
  it("is true once the limit has passed, inclusive", () => {
    expect(
      isIdle({ lastActivityMs: 0, nowMs: 60_000, idleLockMs: 60_000 })
    ).toBe(true);
    expect(
      isIdle({ lastActivityMs: 0, nowMs: 59_999, idleLockMs: 60_000 })
    ).toBe(false);
  });

  it("is false with no limit configured", () => {
    expect(isIdle({ lastActivityMs: 0, nowMs: 1e9, idleLockMs: 0 })).toBe(
      false
    );
    expect(isIdle({ lastActivityMs: 0, nowMs: 1e9, idleLockMs: null })).toBe(
      false
    );
  });

  it("does not lock instantly when the clock goes backwards", () => {
    // An NTP correction or someone changing the date gives a negative elapsed,
    // which must not read as "idle for a very long time".
    expect(
      isIdle({ lastActivityMs: 10_000, nowMs: 0, idleLockMs: 60_000 })
    ).toBe(false);
  });
});
