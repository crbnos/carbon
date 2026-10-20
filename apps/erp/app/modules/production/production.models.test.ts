// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The models' module graph can reach @carbon/content/glossary and Lingui `msg`
// macros at module load, which plain vitest does not transform. The helpers
// under test need neither (same stubs as production.service.test.ts).
vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const {
  isBatchDissolvable,
  isBatchReleasable,
  isJobBulkDeletable,
  isJobBulkReleasable,
  jobStatus
} = await import("./production.models");

describe("isJobBulkDeletable", () => {
  it("accepts Draft, Planned and the 2 deprecated due statuses only", () => {
    const deletable = jobStatus.filter(isJobBulkDeletable);
    expect(deletable).toEqual(["Draft", "Planned", "Overdue", "Due Today"]);
    expect(isJobBulkDeletable(null)).toBe(false);
  });
});

describe("isJobBulkReleasable", () => {
  it("accepts Draft and Planned only", () => {
    expect(jobStatus.filter(isJobBulkReleasable)).toEqual(["Draft", "Planned"]);
  });
});

describe("batch status gates", () => {
  const statuses = ["Planned", "Active", "Completing", "Completed"];

  it("releases a Planned batch only", () => {
    expect(statuses.filter(isBatchReleasable)).toEqual(["Planned"]);
  });

  it("dissolves a Planned or Active batch only", () => {
    expect(statuses.filter(isBatchDissolvable)).toEqual(["Planned", "Active"]);
  });
});
