// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  mayChangeObjective,
  objectiveGroup,
  readObjective
} from "./objectives";

describe("readObjective", () => {
  it("reads a full payload", () => {
    expect(
      readObjective({
        title: "First job on the floor",
        detail: "One job, start to finish",
        event: "jobCompleted",
        targetDate: "2026-11-06",
        goLive: true,
        locationId: "loc_plant"
      })
    ).toEqual({
      title: "First job on the floor",
      detail: "One job, start to finish",
      event: "jobCompleted",
      targetDate: "2026-11-06",
      goLive: true,
      locationId: "loc_plant"
    });
  });

  it("reads unknown or malformed fields as unset", () => {
    expect(
      readObjective({
        title: 42,
        detail: "",
        event: "toString",
        targetDate: "6 Nov 2026",
        goLive: "yes",
        locationId: ""
      })
    ).toEqual({
      title: "",
      detail: undefined,
      event: undefined,
      targetDate: undefined,
      goLive: false,
      locationId: undefined
    });
  });
});

describe("objectiveGroup", () => {
  it("files a go-live objective under go-live even with an event", () => {
    expect(objectiveGroup({ goLive: true, event: "jobReleased" })).toBe(
      "goLive"
    );
  });
  it("files an objective with an event as a milestone", () => {
    expect(objectiveGroup({ goLive: false, event: "quoteSent" })).toBe(
      "milestone"
    );
  });
  it("files the rest as other", () => {
    expect(objectiveGroup({})).toBe("other");
  });
});

describe("mayChangeObjective", () => {
  const customer = { userId: "user_a", isInternal: false, previewing: false };
  const staff = { userId: "user_s", isInternal: true, previewing: false };

  it("lets a person change their own objective", () => {
    expect(mayChangeObjective(customer, "user_a")).toBe(true);
  });
  it("refuses a person someone else's or a company objective", () => {
    expect(mayChangeObjective(customer, "user_b")).toBe(false);
    expect(mayChangeObjective(customer, undefined)).toBe(false);
  });
  it("lets Carbon staff change any objective", () => {
    expect(mayChangeObjective(staff, "user_a")).toBe(true);
    expect(mayChangeObjective(staff, undefined)).toBe(true);
  });
  it("changes nothing while staff preview as the customer", () => {
    expect(mayChangeObjective({ ...staff, previewing: true }, "user_s")).toBe(
      false
    );
  });
  it("refuses before the viewer is known", () => {
    expect(mayChangeObjective({ ...customer, userId: "" }, undefined)).toBe(
      false
    );
  });
});
