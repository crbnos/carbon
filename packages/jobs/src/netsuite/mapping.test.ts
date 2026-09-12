import { describe, expect, it } from "vitest";

import { MigrationIdMap } from "./mapping";

describe("MigrationIdMap", () => {
  it("keeps namespaces separate, so a customer and an item can share an id", () => {
    const map = new MigrationIdMap();
    map.set("customer", "100", "cust_a");
    map.set("item", "100", "item_b");

    expect(map.get("customer", "100")).toBe("cust_a");
    expect(map.get("item", "100")).toBe("item_b");
    expect(map.get("supplier", "100")).toBeUndefined();
  });

  it("treats a missing external id as unresolved rather than throwing", () => {
    const map = new MigrationIdMap();
    expect(map.get("item", null)).toBeUndefined();
    expect(map.get("item", undefined)).toBeUndefined();
    expect(map.get("item", "")).toBeUndefined();
    expect(map.has("item", null)).toBe(false);
  });

  it("does not re-persist mappings read back from the database", () => {
    const map = new MigrationIdMap();
    map.set("customer", "1", "a", { persist: false });
    map.set("customer", "2", "b");

    const pending = map.takePending();
    expect(pending).toEqual([
      { entityType: "customer", entityId: "b", externalId: "2" }
    ]);
    // Both are still resolvable — only the WRITE was skipped.
    expect(map.get("customer", "1")).toBe("a");
  });

  it("empties the pending list when it is taken, so a tier flush is not repeated", () => {
    const map = new MigrationIdMap();
    map.set("item", "1", "a");
    expect(map.takePending()).toHaveLength(1);
    expect(map.takePending()).toHaveLength(0);
  });
});
