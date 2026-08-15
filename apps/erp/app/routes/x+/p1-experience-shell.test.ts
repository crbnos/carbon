import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/auth", () => ({
  getAppUrl: () => "http://localhost:3000",
  getMESUrl: () => "http://localhost:3001",
  SUPABASE_URL: "http://localhost:54321"
}));

describe("P1 experience shell contract", () => {
  it("defines the canonical navigation in the requested order", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "app/components/Layout/Navigation/ExperienceShellNavigation.tsx"
      ),
      "utf8"
    );
    const labels = [
      "Overview",
      "Orders",
      "Production",
      "Materials",
      "Quality",
      "Equipment",
      "Exceptions",
      "Decisions",
      "Administration"
    ];
    let previous = -1;
    for (const label of labels) {
      const index = source.indexOf(`label: "${label}"`);
      expect(index, `${label} is defined`).toBeGreaterThan(previous);
      previous = index;
    }
  });

  it("keeps Exceptions and Decisions honest placeholders", () => {
    for (const route of ["exceptions.tsx", "decisions.tsx"]) {
      const source = readFileSync(
        resolve(process.cwd(), `app/routes/x+/${route}`),
        "utf8"
      );
      expect(source).toContain("ExperiencePlaceholder");
    }
  });

  it("does not duplicate canonical domains in the legacy rail", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "app/components/Layout/Navigation/PrimaryNavigation.tsx"
      ),
      "utf8"
    );
    expect(source).toContain('"production"');
    expect(source).toContain('"settings"');
    expect(source).toContain("CANONICAL_MODULE_KEYS.has");
  });

  it("exposes stable paths for the placeholder destinations", async () => {
    const { path } = await import("~/utils/path");
    expect(path.to.exceptions).toBe("/x/exceptions");
    expect(path.to.decisions).toBe("/x/decisions");
  });
});
