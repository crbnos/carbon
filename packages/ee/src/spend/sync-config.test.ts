import { describe, expect, it } from "vitest";
import { buildSpendSyncConfig } from "./sync-config";

describe("buildSpendSyncConfig", () => {
  it("enables a ceilinged entity when its toggle is absent", () => {
    const config = buildSpendSyncConfig({ ceiling: { purchaseOrder: true } });

    expect(config.entities.purchaseOrder).toMatchObject({
      enabled: true,
      direction: "push-to-accounting",
      owner: "carbon"
    });
  });

  it("disables an entity whose toggle is off", () => {
    const config = buildSpendSyncConfig({
      ceiling: { purchaseOrder: true, bill: true },
      toggles: { bill: false }
    });

    expect(config.entities.purchaseOrder.enabled).toBe(true);
    expect(config.entities.bill.enabled).toBe(false);
  });

  it("lets the ceiling beat a toggle that is on", () => {
    // This is the whole mechanism push-only mode rests on: a user cannot
    // toggle on something the install mode forbids.
    const config = buildSpendSyncConfig({
      ceiling: { bill: false },
      toggles: { bill: true }
    });

    expect(config.entities.bill.enabled).toBe(false);
  });

  it("leaves every entity outside the ceiling disabled", () => {
    const config = buildSpendSyncConfig({
      ceiling: { purchaseOrder: true },
      // A toggle alone must not enable anything — the ceiling is the gate.
      toggles: { invoice: true, journalEntry: true, customer: true }
    });

    for (const entityType of [
      "invoice",
      "journalEntry",
      "customer",
      "bill"
    ] as const) {
      expect(config.entities[entityType].enabled).toBe(false);
    }
  });

  it("does not disturb the accounting defaults it starts from", () => {
    const config = buildSpendSyncConfig({ ceiling: { purchaseOrder: true } });

    // journalEntry defaults ON for accounting providers; a spend provider must
    // not inherit that just because it shares the shape.
    expect(config.entities.journalEntry.enabled).toBe(false);
  });
});
