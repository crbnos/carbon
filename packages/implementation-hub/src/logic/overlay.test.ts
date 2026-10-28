// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { SPINE } from "../content/spine";
import type { StepDef } from "../types";
import {
  effectiveGateStatus,
  effectiveProductStatus,
  gatesDone,
  type Signals,
  spineForTier,
  stateMap
} from "./overlay";

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

const stepByKey = (spine: StepDef[], key: string) => {
  const step = spine.find((s) => s.key === key);
  if (!step) throw new Error(`no step ${key}`);
  return step;
};

// The self-serve Configure gate: three nested product steps.
const configure = stepByKey(
  spineForTier(SPINE, "self_serve"),
  "gate:configure"
);
const configureKeys = (configure.nested ?? []).map((n) => n.key);
const importBom = (configure.nested ?? []).find(
  (n) => n.key === "prod:configure-bom"
)!;

describe("spineForTier", () => {
  it("drops the paid-only gates for self-serve and renumbers the rest", () => {
    const spine = spineForTier(SPINE, "self_serve");
    expect(spine.map((s) => [s.key, s.n])).toEqual([
      ["gate:configure", 1],
      ["gate:train", 2],
      ["gate:golive", 3]
    ]);
  });

  it("drops the paid-only nested steps for self-serve", () => {
    expect(configureKeys).toEqual([
      "prod:configure-data",
      "prod:configure-bom",
      "prod:configure-builtins"
    ]);
  });

  it("keeps every gate and nested step for a paid tier", () => {
    const spine = spineForTier(SPINE, "guided");
    expect(spine).toHaveLength(SPINE.length);
    expect(stepByKey(spine, "gate:configure").nested).toHaveLength(5);
  });
});

describe("effectiveProductStatus", () => {
  it("is done when the step is ticked", () => {
    expect(
      effectiveProductStatus(
        importBom,
        states({ "prod:configure-bom": "done" }),
        NOTHING_DETECTED
      )
    ).toBe("done");
  });

  it("is never completed by detection alone", () => {
    expect(importBom.detect).toBe("hasItems");
    expect(
      effectiveProductStatus(importBom, states({}), EVERYTHING_DETECTED)
    ).toBe("todo");
  });

  it("goes back to todo when the tick is cleared, whatever is detected", () => {
    expect(
      effectiveProductStatus(
        importBom,
        states({ "prod:configure-bom": "todo" }),
        EVERYTHING_DETECTED
      )
    ).toBe("todo");
  });
});

describe("effectiveGateStatus", () => {
  const allNestedTicked = Object.fromEntries(
    configureKeys.map((key) => [key, "done"])
  );

  it("is done when every nested step is ticked", () => {
    expect(
      effectiveGateStatus(configure, states(allNestedTicked), NOTHING_DETECTED)
    ).toBe("done");
  });

  it("is not done from detection, even with every signal true", () => {
    expect(
      effectiveGateStatus(configure, states({}), EVERYTHING_DETECTED)
    ).toBe("todo");
  });

  it("lets an explicit done tick complete the gate on its own", () => {
    expect(
      effectiveGateStatus(
        configure,
        states({ "gate:configure": "done" }),
        NOTHING_DETECTED,
        { done: 0, total: 4 }
      )
    ).toBe("done");
  });

  it("lets an explicit todo tick reopen a gate whose steps are all ticked", () => {
    expect(
      effectiveGateStatus(
        configure,
        states({ ...allNestedTicked, "gate:configure": "todo" }),
        NOTHING_DETECTED,
        { done: 4, total: 4 }
      )
    ).toBe("todo");
  });

  it("completes on all nested steps ticked before it reads task progress", () => {
    expect(
      effectiveGateStatus(
        configure,
        states(allNestedTicked),
        NOTHING_DETECTED,
        {
          done: 0,
          total: 4
        }
      )
    ).toBe("done");
  });

  it("follows task progress when the gate has tasks", () => {
    const gate = states({});
    expect(
      effectiveGateStatus(configure, gate, NOTHING_DETECTED, {
        done: 0,
        total: 4
      })
    ).toBe("todo");
    expect(
      effectiveGateStatus(configure, gate, NOTHING_DETECTED, {
        done: 1,
        total: 4
      })
    ).toBe("prog");
    expect(
      effectiveGateStatus(configure, gate, NOTHING_DETECTED, {
        done: 4,
        total: 4
      })
    ).toBe("done");
  });

  it("ignores partial nested progress when the gate has tasks", () => {
    expect(
      effectiveGateStatus(
        configure,
        states({ "prod:configure-data": "done" }),
        NOTHING_DETECTED,
        { done: 0, total: 4 }
      )
    ).toBe("todo");
  });

  it("falls back to partial nested progress when the gate has no tasks", () => {
    const progress = states({ "prod:configure-data": "done" });
    expect(effectiveGateStatus(configure, progress, NOTHING_DETECTED)).toBe(
      "prog"
    );
    expect(
      effectiveGateStatus(configure, progress, NOTHING_DETECTED, {
        done: 0,
        total: 0
      })
    ).toBe("prog");
  });

  it("is todo for a gate with no nested steps, no tasks and no tick", () => {
    const train = stepByKey(spineForTier(SPINE, "self_serve"), "gate:train");
    expect(effectiveGateStatus(train, states({}), EVERYTHING_DETECTED)).toBe(
      "todo"
    );
  });
});

describe("gatesDone", () => {
  it("counts the gates that resolve to done", () => {
    const spine = spineForTier(SPINE, "self_serve");
    expect(gatesDone(spine, states({}), EVERYTHING_DETECTED)).toBe(0);
    expect(
      gatesDone(
        spine,
        states({
          "prod:configure-data": "done",
          "prod:configure-bom": "done",
          "prod:configure-builtins": "done",
          "gate:golive": "done"
        }),
        NOTHING_DETECTED
      )
    ).toBe(2);
  });
});
