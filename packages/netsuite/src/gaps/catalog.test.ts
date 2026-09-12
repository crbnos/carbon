import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { GAP_CATALOG, gapById } from "./catalog.ts";
import { detectGaps, summarizeGaps } from "./detect.ts";
import { renderGapsMarkdown } from "./markdown.ts";

describe("GAP_CATALOG", () => {
  it("has a unique, stable id per gap", () => {
    const ids = GAP_CATALOG.map((gap) => gap.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^NS-[A-Z]{3}-\d{3}$/);
  });

  it("gives every gap a workaround — a gap with no answer is a bug report", () => {
    for (const gap of GAP_CATALOG) {
      expect(
        gap.workaround.length,
        `${gap.id} has no workaround`
      ).toBeGreaterThan(20);
      expect(gap.detail.length, `${gap.id} has no detail`).toBeGreaterThan(40);
    }
  });

  it("looks a gap up by id", () => {
    expect(gapById("NS-ACC-001")?.area).toBe("accounting");
    expect(gapById("NOPE")).toBeUndefined();
  });
});

describe("GAPS.md", () => {
  it("is regenerated from the catalog and has not drifted", () => {
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "GAPS.md"
    );
    const onDisk = readFileSync(path, "utf8");
    expect(
      onDisk,
      "GAPS.md is stale — run `pnpm --filter @carbon/netsuite generate:gaps`"
    ).toBe(renderGapsMarkdown());
  });
});

describe("detectGaps", () => {
  it("drops a gap that extraction proved does not apply", () => {
    const gaps = detectGaps({ counts: { "NS-MFG-003": 0 } });
    expect(gaps.some((gap) => gap.id === "NS-MFG-003")).toBe(false);
  });

  it("keeps a gap extraction could not probe, with a null count", () => {
    const gaps = detectGaps({});
    const workOrders = gaps.find((gap) => gap.id === "NS-MFG-003");
    expect(workOrders?.count).toBeNull();
  });

  it("leads with the severe, countable gaps", () => {
    const gaps = detectGaps({
      counts: { "NS-MFG-003": 4, "NS-INV-002": 900, "NS-CUS-002": 3 }
    });
    expect(gaps[0]?.id).toBe("NS-INV-002");
    // A low-severity gap never outranks a high-severity one, however big its count.
    const lowIndex = gaps.findIndex((gap) => gap.severity === "low");
    const highIndex = gaps.findIndex((gap) => gap.severity === "high");
    expect(highIndex).toBeLessThan(lowIndex);
  });

  it("summarizes for the completion notice", () => {
    expect(summarizeGaps([])).toContain("No known gaps");
    expect(summarizeGaps(detectGaps({}))).toContain("significant");
  });
});
