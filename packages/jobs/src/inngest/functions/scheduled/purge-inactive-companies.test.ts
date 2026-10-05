// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../client", () => ({
  inngest: { createFunction: () => ({}) }
}));
vi.mock("./company-cleanup", () => ({}));

const { purgeRefusal, resolvePurgeOptions } = await import(
  "./purge-inactive-companies"
);

describe("purgeRefusal", () => {
  it("allows only a dashboard invoke on Cloud", () => {
    expect(purgeRefusal("inngest/function.invoked", "cloud")).toBeNull();
  });

  it.each([
    ["a sent event", "carbon/purge-inactive-companies", "cloud"],
    ["a cron tick", "inngest/scheduled.timer", "cloud"],
    ["Community", "inngest/function.invoked", "community"],
    ["Enterprise", "inngest/function.invoked", "enterprise"],
    ["no edition", "inngest/function.invoked", undefined]
  ])("refuses %s", (_label, name, edition) => {
    expect(purgeRefusal(name, edition)).not.toBeNull();
  });
});

describe("resolvePurgeOptions", () => {
  it.each([
    ["an empty payload", {}],
    ["dryRun true", { dryRun: true }],
    ["the string false", { dryRun: "false" }],
    ["zero", { dryRun: 0 }],
    ["null", { dryRun: null }]
  ])("is a dry run for %s", (_label, data) => {
    expect(resolvePurgeOptions(data).dryRun).toBe(true);
  });

  it("deletes only for dryRun false", () => {
    expect(resolvePurgeOptions({ dryRun: false }).dryRun).toBe(false);
  });

  it("caps a run at 500 companies and never goes below zero", () => {
    expect(resolvePurgeOptions({}).limit).toBe(500);
    expect(resolvePurgeOptions({ limit: 5000 }).limit).toBe(500);
    expect(resolvePurgeOptions({ limit: 25.9 }).limit).toBe(25);
    expect(resolvePurgeOptions({ limit: -3 }).limit).toBe(0);
    expect(resolvePurgeOptions({ limit: "50" }).limit).toBe(500);
  });
});
