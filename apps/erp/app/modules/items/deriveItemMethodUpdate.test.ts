import { describe, expect, it, vi } from "vitest";

// Importing items.models drags in the modules/shared barrel graph, which
// transitively loads @carbon/glossary — whose module-load-time Lingui `msg`
// macro isn't transformed under plain vitest and throws. The pure interlock
// under test needs none of it, so stub glossary and dynamic-import after
// (mirrors items.service.test.ts).
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn()
}));

const { deriveItemMethodUpdate } = await import("./items.models");

describe("deriveItemMethodUpdate (interlock reused per BoM line)", () => {
  it("sourcing Drop Ship pins methodType Purchase to Order", () => {
    const r = deriveItemMethodUpdate("sourcingType", "Drop Ship");
    expect(r.cascade.methodType).toBe("Purchase to Order");
    expect(r.cascade.sourcingType).toBe("Drop Ship");
  });
  it("sourcing Ship from Inventory pins methodType Pull from Inventory", () => {
    const r = deriveItemMethodUpdate("sourcingType", "Ship from Inventory");
    expect(r.cascade.methodType).toBe("Pull from Inventory");
  });
  it("sourcing Specified leaves methodType unset (unchanged)", () => {
    const r = deriveItemMethodUpdate("sourcingType", "Specified");
    expect(r.cascade.methodType).toBeUndefined();
  });
  it("replenishment Make pins methodType Make to Order", () => {
    const r = deriveItemMethodUpdate("replenishmentSystem", "Make");
    expect(r.itemUpdate.defaultMethodType).toBe("Make to Order");
  });
  it("replenishment Buy pins methodType Purchase to Order", () => {
    const r = deriveItemMethodUpdate("replenishmentSystem", "Buy");
    expect(r.itemUpdate.defaultMethodType).toBe("Purchase to Order");
  });
});
