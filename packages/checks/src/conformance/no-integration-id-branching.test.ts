import { describe, expect, it } from "vitest";
import { noIntegrationIdBranching } from "./no-integration-id-branching";

const scan = (file: string, contents: string) =>
  noIntegrationIdBranching.scan(file, contents);

describe("no-integration-id-branching", () => {
  it("flags an equality branch on an integration id", () => {
    const found = scan(
      "packages/jobs/src/inngest/functions/integrations/sweep.ts",
      'if (integrationId === "ramp") { return; }'
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).toContain("ramp");
  });

  it("flags an inequality branch too", () => {
    expect(
      scan("apps/erp/app/routes/x+/thing.tsx", 'x !== "rillet"')
    ).toHaveLength(1);
  });

  it("flags an ad-hoc id array", () => {
    const found = scan(
      "apps/erp/app/modules/accounting/accounting.service.ts",
      'const IDS = ["xero", "quickbooks", "rillet"];'
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it("flags a Set of ids", () => {
    expect(
      scan(
        "packages/ee/src/accounting/core/posting.ts",
        'new Set(["xero", "quickbooks"])'
      )
    ).toHaveLength(1);
  });

  it("allows a provider naming ITSELF inside its own directory", () => {
    // packages/ee/src/ramp/** is Ramp's own code; saying "ramp" there is not a
    // branch on identity, it IS the identity.
    expect(
      scan("packages/ee/src/ramp/lib/spend.ts", 'const RAMP = "ramp";')
    ).toEqual([]);
  });

  it("allows the registry and the legitimately id-keyed maps", () => {
    for (const file of [
      "packages/ee/src/index.ts",
      "packages/ee/src/hooks.server.ts",
      "packages/ee/src/integrations/secrets.ts",
      "apps/erp/app/modules/settings/integration-errors.ts"
    ]) {
      expect(scan(file, 'x === "ramp"; ["xero", "rillet"]')).toEqual([]);
    }
  });

  it("allows the sync core, which is the replacement", () => {
    expect(scan("packages/ee/src/sync/topology.ts", 'id === "ramp"')).toEqual(
      []
    );
  });

  it("ignores an unrelated string that merely contains an id", () => {
    expect(
      scan("apps/erp/app/thing.ts", 'const label = "Ramp connection";')
    ).toEqual([]);
  });

  it("reports the line number", () => {
    const found = scan("apps/erp/app/thing.ts", '\n\nif (a === "xero") {}');
    expect(found[0]?.line).toBe(3);
  });
});
