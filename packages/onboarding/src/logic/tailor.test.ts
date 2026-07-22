import { describe, expect, it } from "vitest";
import type { IntakeAnswers } from "../content/intake";
import { diffIntake } from "./diffIntake";
import {
  chipForSetupRow,
  complexityBand,
  complexityFlags,
  setupCounts,
  suggestedWeeks,
  tailorPlan
} from "./tailor";

// A small factory that answers everything "simple".
const SIMPLE: IntakeAnswers = {
  product: "sheet-metal enclosures",
  people: "1-10",
  sites: "one",
  workIntake: ["quote"],
  customers: "under-25",
  fulfillment: "mto",
  jobsPerMonth: "under-20",
  tracking: "none",
  quality: "informal",
  systems: ["spreadsheets"],
  books: "keep",
  items: "under-100",
  boms: "spreadsheets",
  weeklyHours: "few-hours"
};

const COMPLEX: IntakeAnswers = {
  ...SIMPLE,
  people: "31-100",
  sites: "2-3",
  quality: "regulated",
  tracking: "serials",
  trackingRequired: true,
  systems: ["legacy-erp"],
  legacyErpName: "JobBOSS",
  items: "1k-10k",
  books: "move"
};

describe("complexityBand", () => {
  it("is simple for a small spreadsheet factory keeping its books", () => {
    expect(complexityBand(SIMPLE)).toBe("simple");
  });

  it("is standard once the factory outgrows any simple criterion", () => {
    expect(complexityBand({ ...SIMPLE, people: "11-30" })).toBe("standard");
    expect(complexityBand({ ...SIMPLE, items: "100-1k" })).toBe("standard");
    expect(complexityBand({ ...SIMPLE, quality: "inspect" })).toBe("standard");
  });

  it("is complex on any hard signal", () => {
    expect(complexityBand({ ...SIMPLE, systems: ["legacy-erp"] })).toBe(
      "complex"
    );
    expect(complexityBand({ ...SIMPLE, sites: "4+" })).toBe("complex");
    expect(complexityBand({ ...SIMPLE, quality: "regulated" })).toBe("complex");
    expect(complexityBand({ ...SIMPLE, items: "over-10k" })).toBe("complex");
    expect(
      complexityBand({ ...SIMPLE, tracking: "serials", trackingRequired: true })
    ).toBe("complex");
  });

  it("does not treat voluntary serial tracking as complex", () => {
    expect(
      complexityBand({ ...SIMPLE, tracking: "serials", trackingRequired: false })
    ).toBe("simple");
  });
});

describe("suggestedWeeks", () => {
  it("bands to roughly 30/60/90 days", () => {
    expect(suggestedWeeks(SIMPLE)).toBe(5);
    expect(suggestedWeeks({ ...SIMPLE, people: "11-30" })).toBe(9);
    expect(suggestedWeeks({ ...COMPLEX, books: "keep" })).toBe(13);
  });

  it("moving the books adds weeks", () => {
    expect(suggestedWeeks({ ...SIMPLE, people: "11-30", books: "move" })).toBe(
      12
    );
  });
});

describe("complexityFlags", () => {
  it("raises no flags for the simple factory", () => {
    expect(complexityFlags(SIMPLE)).toHaveLength(0);
  });

  it("raises the template's flags", () => {
    const keys = complexityFlags(COMPLEX).map((f) => f.key);
    expect(keys).toContain("regulated-quality");
    expect(keys).toContain("regulated-tracking");
    expect(keys).toContain("legacy-erp");
    expect(keys).toContain("erp-and-books");
  });

  it("flags an effort mismatch only on a complex plan", () => {
    const mismatch = complexityFlags({
      ...COMPLEX,
      books: "keep",
      weeklyHours: "few-hours"
    }).map((f) => f.key);
    expect(mismatch).toContain("effort-mismatch");

    const fine = complexityFlags({
      ...SIMPLE,
      weeklyHours: "few-hours"
    }).map((f) => f.key);
    expect(fine).not.toContain("effort-mismatch");
  });
});

describe("tailorPlan", () => {
  it("hides accounting with a receipt when the books stay put", () => {
    const t = tailorPlan(SIMPLE);
    expect(t.excludeModules.map((e) => e.mod)).toContain("acc");
    expect(t.receipts.length).toBeGreaterThan(0);
  });

  it("keeps accounting and raises a conflict when reality disagrees", () => {
    const t = tailorPlan(SIMPLE, { accountingEnabled: true });
    expect(t.excludeModules.map((e) => e.mod)).not.toContain("acc");
    expect(t.conflicts).toHaveLength(1);
  });

  it("hides quality only when quality is informal", () => {
    expect(tailorPlan(SIMPLE).excludeModules.map((e) => e.mod)).toContain(
      "qms"
    );
    expect(
      tailorPlan({ ...SIMPLE, quality: "inspect" }).excludeModules.map(
        (e) => e.mod
      )
    ).not.toContain("qms");
  });

  it("hides catalog pricing for quote-only factories, with receipts", () => {
    const t = tailorPlan(SIMPLE);
    expect(t.hiddenSetup.has("price-lists")).toBe(true);
    expect(t.hiddenSetup.has("pricing-rules")).toBe(true);
    expect(t.hiddenSetup.has("no-quote-reasons")).toBe(false);
  });

  it("never hides or defers a required row", () => {
    const t = tailorPlan(SIMPLE);
    for (const key of t.requiredSetup) {
      expect(t.hiddenSetup.has(key)).toBe(false);
      expect(t.laterSetup.has(key)).toBe(false);
    }
  });

  it("defers small-team and few-items rows instead of hiding them", () => {
    const t = tailorPlan(SIMPLE);
    expect(t.laterSetup.has("departments")).toBe(true);
    expect(t.laterSetup.has("material-grades")).toBe(true);
    expect(t.hiddenSetup.has("departments")).toBe(false);
  });

  it("chips rows required / later / recommended", () => {
    const t = tailorPlan(SIMPLE);
    expect(chipForSetupRow("company", t)).toBe("required");
    expect(chipForSetupRow("departments", t)).toBe("later");
    expect(chipForSetupRow("shifts", t)).toBe("recommended");
  });

  it("counts hidden vs visible rows for the receipts line", () => {
    const simple = setupCounts(tailorPlan(SIMPLE));
    const complex = setupCounts(tailorPlan({ ...COMPLEX }));
    expect(simple.hidden).toBeGreaterThan(0);
    expect(simple.visible + simple.hidden).toBe(
      complex.visible + complex.hidden
    ); // same total universe
    expect(complex.visible).toBeGreaterThan(simple.visible);
  });
});

describe("diffIntake", () => {
  it("reports no changes for identical answers", () => {
    const d = diffIntake(SIMPLE, { ...SIMPLE });
    expect(d.hasChanges).toBe(false);
    expect(d.answers).toHaveLength(0);
  });

  it("lists changed answers in question terms", () => {
    const d = diffIntake(SIMPLE, { ...SIMPLE, quality: "iso" });
    expect(d.hasChanges).toBe(true);
    expect(d.answers).toHaveLength(1);
    expect(d.answers[0]?.from).toBe("informal");
    expect(d.answers[0]?.to).toBe("iso");
  });

  it("derives timeline movement when a change re-bands the factory", () => {
    const d = diffIntake(SIMPLE, { ...SIMPLE, systems: ["legacy-erp"] });
    expect(d.planChanges.length).toBeGreaterThan(0);
    // Banding moves the clock, not visibility — nothing new shows or hides.
    expect(d.newlyShown).toBe(0);
    expect(d.newlyHidden).toBe(0);
  });

  it("reveals steps when an answer brings a module back", () => {
    const d = diffIntake(SIMPLE, { ...SIMPLE, quality: "iso" });
    expect(d.newlyShown).toBeGreaterThan(0);
    expect(d.planChanges.length).toBeGreaterThan(0);
  });

  it("re-tuning back restores exactly the earlier shape", () => {
    const there = diffIntake(SIMPLE, COMPLEX);
    const back = diffIntake(COMPLEX, SIMPLE);
    expect(there.newlyShown).toBe(back.newlyHidden);
    expect(there.newlyHidden).toBe(back.newlyShown);
  });
});
