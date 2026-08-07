import { describe, expect, it } from "vitest";
import { ProviderID } from "./core/models";
import {
  getEntitySyncView,
  SOURCE_OF_TRUTH_ENTITY_TYPES
} from "./entity-sync-view";

describe("getEntitySyncView", () => {
  it("Xero: all five document entities are configurable", () => {
    const view = getEntitySyncView(ProviderID.XERO, {});

    expect(view).toHaveLength(SOURCE_OF_TRUTH_ENTITY_TYPES.length);
    expect(view.every((entry) => entry.configurable)).toBe(true);
    expect(view.every((entry) => entry.note === undefined)).toBe(true);
  });

  it("QuickBooks Online: all five document entities are configurable", () => {
    const view = getEntitySyncView(ProviderID.QUICKBOOKS, {});

    expect(view).toHaveLength(SOURCE_OF_TRUTH_ENTITY_TYPES.length);
    expect(view.every((entry) => entry.configurable)).toBe(true);
    expect(view.every((entry) => entry.note === undefined)).toBe(true);
  });

  it("Rillet: all five document entities are forced to Carbon and not configurable", () => {
    const view = getEntitySyncView(ProviderID.RILLET, {});

    expect(view).toHaveLength(SOURCE_OF_TRUTH_ENTITY_TYPES.length);
    for (const entry of view) {
      expect(entry.configurable).toBe(false);
      expect(entry.owner).toBe("carbon");
      expect(entry.note).toBeDefined();
      expect(entry.note).toContain("Rillet");
      expect(entry.note).toContain("Carbon is the source of truth");
    }
  });

  it("an unrecognized provider id has no forcing — every entity is configurable", () => {
    const view = getEntitySyncView("some-future-provider", {});

    expect(view.every((entry) => entry.configurable)).toBe(true);
    expect(view.every((entry) => entry.note === undefined)).toBe(true);
  });

  it("a stored owner override on a configurable entity (Xero customer) is honored", () => {
    const metadata = {
      syncConfig: { entities: { customer: { owner: "carbon" } } }
    };
    const view = getEntitySyncView(ProviderID.XERO, metadata);
    const customer = view.find((entry) => entry.entityType === "customer");

    expect(customer?.owner).toBe("carbon");
    expect(customer?.configurable).toBe(true);
  });

  it("a stored owner override on a forced entity (Rillet customer) is ignored", () => {
    const metadata = {
      syncConfig: { entities: { customer: { owner: "accounting" } } }
    };
    const view = getEntitySyncView(ProviderID.RILLET, metadata);
    const customer = view.find((entry) => entry.entityType === "customer");

    expect(customer?.owner).toBe("carbon");
    expect(customer?.configurable).toBe(false);
  });
});
