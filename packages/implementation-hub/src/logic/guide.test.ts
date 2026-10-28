// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { SPINE } from "../content/spine";
import { nextAction } from "./guide";
import { type Signals, spineForTier, stateMap } from "./overlay";

const NOTHING_DETECTED: Signals = {
  hasItems: false,
  hasMakeMethod: false,
  hasJob: false,
  hasSalesOrder: false,
  hasTrackedEntity: false
};

const EVERYTHING_DETECTED: Signals = {
  hasItems: true,
  hasMakeMethod: true,
  hasJob: true,
  hasSalesOrder: true,
  hasTrackedEntity: true
};

const states = (entries: Record<string, string>) =>
  stateMap(
    Object.entries(entries).map(([itemKey, value]) => ({
      itemKey,
      kind: itemKey.startsWith("prod:") ? "productStep" : "gate",
      value
    }))
  );

// Self-serve: Configure (three nested steps), Train, Go-Live.
const selfServe = spineForTier(SPINE, "self_serve");

describe("nextAction", () => {
  it("starts at the first unticked product step of the first gate", () => {
    const next = nextAction(selfServe, states({}), NOTHING_DETECTED);
    expect(next?.gateKey).toBe("gate:configure");
    expect(next?.gateNumber).toBe(1);
    expect(next?.productStep?.key).toBe("prod:configure-data");
    expect(next?.title.message).toBe("Set up your resources and settings");
    expect(next?.refSlug).toBe("setup");
    expect(next?.refTitle.message).toBe("Setup Map");
  });

  it("skips the product steps already ticked", () => {
    const next = nextAction(
      selfServe,
      states({ "prod:configure-data": "done" }),
      NOTHING_DETECTED
    );
    expect(next?.gateKey).toBe("gate:configure");
    expect(next?.productStep?.key).toBe("prod:configure-bom");
  });

  it("still points at a step that detection sees but nobody ticked", () => {
    const next = nextAction(
      selfServe,
      states({ "prod:configure-data": "done" }),
      EVERYTHING_DETECTED
    );
    expect(next?.productStep?.key).toBe("prod:configure-bom");
  });

  it("moves to the next gate once the gate is done", () => {
    const next = nextAction(
      selfServe,
      states({ "gate:configure": "done" }),
      NOTHING_DETECTED
    );
    expect(next?.gateKey).toBe("gate:train");
    expect(next?.gateNumber).toBe(2);
    expect(next?.productStep).toBeUndefined();
    expect(next?.title.message).toBe("Train");
    expect(next?.refSlug).toBe("training");
    expect(next?.refTitle.message).toBe("Training Plan");
  });

  it("moves to the next gate once every product step is ticked", () => {
    const next = nextAction(
      selfServe,
      states({
        "prod:configure-data": "done",
        "prod:configure-bom": "done",
        "prod:configure-builtins": "done"
      }),
      NOTHING_DETECTED
    );
    expect(next?.gateKey).toBe("gate:train");
  });

  it("returns the gate itself when its first gate has no product steps", () => {
    const next = nextAction(
      spineForTier(SPINE, "guided"),
      states({}),
      NOTHING_DETECTED
    );
    expect(next?.gateKey).toBe("gate:discovery");
    expect(next?.productStep).toBeUndefined();
    expect(next?.refTitle.message).toBe("Scope Summary");
  });

  it("returns null when every gate is done", () => {
    const allDone = Object.fromEntries(
      selfServe.map((step) => [step.key, "done"])
    );
    expect(nextAction(selfServe, states(allDone), NOTHING_DETECTED)).toBeNull();
  });
});
