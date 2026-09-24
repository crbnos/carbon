import { describe, expect, it } from "vitest";
import { TABLE_TO_ENTITY_MAP } from "../events/sync-tables";
import { MASTER_DATA_SWEEP_TARGETS } from "./master-data-targets";

/**
 * The sweep reads a TABLE and enqueues an ENTITY TYPE, and the two names differ
 * for exactly one pairing: `vendor` lives in `supplier`. Writing `table:
 * "vendor"` compiles (it is a plain string union) and then sweeps a table that
 * does not exist, or — worse, if a `vendor` table is ever added — the wrong
 * rows. `TABLE_TO_ENTITY_MAP` is the same pairing the event path already uses,
 * so pinning against it means the sweep and the events can never disagree about
 * where an entity's rows live.
 */
describe("master-data sweep targets", () => {
  it("reads the table the event path maps to the same entity type", () => {
    for (const target of MASTER_DATA_SWEEP_TARGETS) {
      expect(TABLE_TO_ENTITY_MAP[target.table]).toBe(target.entityType);
    }
  });

  it("covers every master entity type exactly once", () => {
    const entityTypes = MASTER_DATA_SWEEP_TARGETS.map((t) => t.entityType);
    expect(new Set(entityTypes).size).toBe(entityTypes.length);
    expect(entityTypes.sort()).toEqual(["customer", "item", "vendor"]);
  });

  it("sweeps only the item master on the reduced cadence", () => {
    // An item master runs to six figures where a contact master runs to
    // hundreds. Putting customers or vendors on the hourly pass would halve the
    // catch-up rate for the tables that actually accumulate the gap.
    const hourlyOnly = MASTER_DATA_SWEEP_TARGETS.filter((t) => t.hourlyOnly);
    expect(hourlyOnly.map((t) => t.entityType)).toEqual(["item"]);
  });

  it("gives the item master a larger page than the contact masters", () => {
    const item = MASTER_DATA_SWEEP_TARGETS.find((t) => t.entityType === "item");
    const vendor = MASTER_DATA_SWEEP_TARGETS.find(
      (t) => t.entityType === "vendor"
    );
    expect(item?.limit).toBeGreaterThan(vendor?.limit ?? 0);
  });
});
