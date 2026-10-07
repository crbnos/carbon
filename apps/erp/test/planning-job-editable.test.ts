// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The models barrel reaches the glossary's lingui macros, which vitest does not
// transform (same stub as Schedule/Kanban/date-utils.test.ts).
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import { isJobEditableFromPlanning } from "../app/modules/production/production.models";

// Planning's Apply used a blocklist (Ready / In Progress / Paused), so a job
// completed, closed or cancelled after MRP ran could still be edited or
// re-cancelled from a stale action. Only an unreleased job may change.
describe("isJobEditableFromPlanning", () => {
  it("allows a job that is not released yet", () => {
    expect(isJobEditableFromPlanning("Draft")).toBe(true);
    expect(isJobEditableFromPlanning("Planned")).toBe(true);
  });

  it("refuses a job on the floor", () => {
    expect(isJobEditableFromPlanning("Ready")).toBe(false);
    expect(isJobEditableFromPlanning("In Progress")).toBe(false);
    expect(isJobEditableFromPlanning("Paused")).toBe(false);
  });

  it("refuses a job that is finished, closed or cancelled", () => {
    expect(isJobEditableFromPlanning("Completed")).toBe(false);
    expect(isJobEditableFromPlanning("Closed")).toBe(false);
    expect(isJobEditableFromPlanning("Cancelled")).toBe(false);
  });

  it("refuses a job with no status", () => {
    expect(isJobEditableFromPlanning(null)).toBe(false);
    expect(isJobEditableFromPlanning(undefined)).toBe(false);
  });
});
