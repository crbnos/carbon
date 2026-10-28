// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { setupI18n } from "@lingui/core";
import { describe, expect, it } from "vitest";
import { SPINE } from "../content/spine";
import type { Tier } from "../types";
import { spineForTier } from "./overlay";
import {
  gateDateKey,
  PLAN_START_KEY,
  phaseWeeksKey,
  resolveTimeline,
  toISODate
} from "./timeline";

const i18n = setupI18n({ locale: "en", messages: { en: {} } });

const timelineFor = (tier: Tier, fields: Record<string, string> = {}) =>
  resolveTimeline(
    spineForTier(SPINE, tier),
    new Map(Object.entries(fields)),
    i18n
  );

const bar = (timeline: ReturnType<typeof timelineFor>, key: string) => {
  const found = timeline.bars.find((b) => b.key === key);
  if (!found) throw new Error(`no bar for ${key}`);
  return found;
};

describe("resolveTimeline, relative weeks", () => {
  it("starts a self-serve timeline at week 1, with labels from the shifted weeks", () => {
    const timeline = timelineFor("self_serve");
    const configure = bar(timeline, "gate:configure");
    expect(configure.startPct).toBe(0);
    expect(configure.timing).toBe("Weeks 1 to 4");
    expect(bar(timeline, "gate:train").timing).toBe("Weeks 4 to 6");
    expect(bar(timeline, "gate:golive").timing).toBe("Week 7");
    // No empty week at either end.
    expect(timeline.totalWeeks).toBe(7);
    expect(bar(timeline, "gate:golive").gatePct).toBe(100);
  });

  it("leaves the paid tiers on the template's curated labels", () => {
    const timeline = timelineFor("guided");
    expect(bar(timeline, "gate:discovery").startPct).toBe(0);
    expect(bar(timeline, "gate:discovery").timing).toBe("Weeks 1 to 2");
    expect(bar(timeline, "gate:configure").timing).toBe("Weeks 2 to 5");
    expect(bar(timeline, "gate:golive").timing).toBe("Week 8 cutover");
    expect(timeline.totalWeeks).toBe(8);
  });

  it("derives the label of a phase whose duration was overridden", () => {
    const timeline = timelineFor("guided", {
      [phaseWeeksKey("gate:configure")]: "6"
    });
    expect(bar(timeline, "gate:configure").timing).toBe("Weeks 2 to 7");
  });
});

describe("resolveTimeline, anchored to dates", () => {
  it("starts the first self-serve phase on the project start date", () => {
    const timeline = timelineFor("self_serve", {
      [PLAN_START_KEY]: "2026-01-05"
    });
    const configure = bar(timeline, "gate:configure");
    expect(timeline.hasDates).toBe(true);
    expect(configure.timing).toBe("Jan 5 – Feb 2");
    expect(toISODate(configure.gateDate!)).toBe("2026-02-02");
    expect(toISODate(bar(timeline, "gate:golive").gateDate!)).toBe(
      "2026-02-23"
    );
  });

  it("back-computes the self-serve start from a go-live date alone", () => {
    const timeline = timelineFor("self_serve", {
      [gateDateKey("gate:golive")]: "2026-02-23"
    });
    expect(bar(timeline, "gate:configure").timing).toBe("Jan 5 – Feb 2");
    expect(toISODate(bar(timeline, "gate:golive").gateDate!)).toBe(
      "2026-02-23"
    );
  });

  it("keeps the paid-tier dates where they were", () => {
    const timeline = timelineFor("guided", { [PLAN_START_KEY]: "2026-01-05" });
    expect(toISODate(bar(timeline, "gate:discovery").gateDate!)).toBe(
      "2026-01-19"
    );
    expect(toISODate(bar(timeline, "gate:configure").gateDate!)).toBe(
      "2026-02-09"
    );
    expect(toISODate(bar(timeline, "gate:golive").gateDate!)).toBe(
      "2026-03-02"
    );
  });
});
