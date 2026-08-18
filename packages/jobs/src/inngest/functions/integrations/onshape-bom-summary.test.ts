import { describe, expect, it } from "vitest";
import type { OnshapeBomImportOutcome } from "./onshape-bom-outcome";
import { summarizeOutcomeForUser } from "./onshape-bom-outcome";

const outcome = (
  overrides: Partial<OnshapeBomImportOutcome> = {}
): OnshapeBomImportOutcome => ({
  imported: 0,
  created: 0,
  adopted: 0,
  updated: 0,
  removed: 0,
  assetsAttached: 0,
  assetsSkipped: 0,
  unreadableRows: 0,
  protectedLines: 0,
  skipped: [],
  ...overrides
});

describe("summarizeOutcomeForUser", () => {
  it("names the refused parts rather than only counting them", () => {
    const text = summarizeOutcomeForUser(
      outcome({
        imported: 4,
        created: 1,
        skipped: [
          {
            partNumber: "EL-402",
            revision: "A",
            reason: "Carbon has this part but not at this revision"
          }
        ]
      })
    );

    expect(text).toContain("4 line(s) imported, 1 part(s) created");
    expect(text).toContain("EL-402.A");
    expect(text).toContain("not at this revision");
  });

  it("renders an unrevised part without a trailing dot", () => {
    const text = summarizeOutcomeForUser(
      outcome({
        skipped: [{ partNumber: "SA-800", revision: "", reason: "Ambiguous" }]
      })
    );

    expect(text).toContain("SA-800: Ambiguous");
    expect(text).not.toContain("SA-800.:");
  });

  it("caps the list and counts the remainder", () => {
    const text = summarizeOutcomeForUser(
      outcome({
        skipped: Array.from({ length: 8 }, (_, index) => ({
          partNumber: `P-${index}`,
          revision: "",
          reason: "Ambiguous"
        }))
      })
    );

    expect(text).toContain("P-4");
    expect(text).not.toContain("P-5");
    expect(text).toContain("and 3 more");
  });

  it("explains a protected line and an unreadable row, which have no skip entry", () => {
    const text = summarizeOutcomeForUser(
      outcome({ protectedLines: 2, unreadableRows: 3 })
    );

    expect(text).toContain("2 existing line(s) left untouched");
    expect(text).toContain("3 Onshape row(s) could not be read");
    expect(text).toContain("nothing was removed");
  });

  it("says nothing about skips when there were none", () => {
    const text = summarizeOutcomeForUser(outcome({ imported: 6 }));
    expect(text).toBe("6 line(s) imported, 0 part(s) created");
  });

  it("reports an adopted part as linked, not created", () => {
    const text = summarizeOutcomeForUser(
      outcome({ imported: 3, created: 1, adopted: 2 })
    );
    expect(text).toContain("1 part(s) created");
    expect(text).toContain("2 existing part(s) linked to Onshape");
  });
});
