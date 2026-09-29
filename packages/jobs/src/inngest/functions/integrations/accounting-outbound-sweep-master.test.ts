import { describe, expect, it } from "vitest";
import { TABLE_TO_ENTITY_MAP } from "../events/sync-tables";
import {
  isHourlyMasterDataPass,
  MASTER_DATA_SWEEP_TARGETS
} from "./master-data-targets";

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

  it("sweeps the contact masters, and ONLY the contact masters", () => {
    // `item` must never come back. Carbon's item master is a manufacturing
    // parts catalog, and sweeping it mirrored up to 500 unmapped parts an hour
    // into the provider's Products & Services list — the catalog dump that
    // removing the `item` event subscription was meant to stop. Items reach a
    // provider JIT from the orders and adjustments that reference them, plus the
    // deliberate one-shot "Push customers, vendors & items" action.
    const entityTypes = MASTER_DATA_SWEEP_TARGETS.map((t) => t.entityType);
    expect(new Set(entityTypes).size).toBe(entityTypes.length);
    expect(entityTypes.sort()).toEqual(["customer", "vendor"]);
  });

  it("puts no target on the reduced cadence", () => {
    // Both contact masters run to hundreds of rows, so halving their catch-up
    // rate buys nothing. The gate itself stays — see `MasterDataSweepTarget`.
    expect(MASTER_DATA_SWEEP_TARGETS.filter((t) => t.hourlyOnly)).toEqual([]);
  });
});

/**
 * The slot must come from the RUN's scheduled time. Read from the wall clock
 * inside a per-company step it flips mid-run once the tenant list crosses :30 —
 * every tenant after the boundary silently skips the hourly targets — and it
 * flips again on a step retry that lands in the other half hour.
 */
describe("isHourlyMasterDataPass", () => {
  const at = (iso: string) => isHourlyMasterDataPass(Date.parse(iso));

  it("is the :15 pass, in UTC", () => {
    expect(at("2026-09-28T04:15:00.000Z")).toBe(true);
    expect(at("2026-09-28T04:45:00.000Z")).toBe(false);
  });

  it("holds the same answer for every tenant of one run", () => {
    // The scheduled instant is the only input, so a run that starts at :15 and
    // takes an hour still answers `true` for its last tenant.
    const scheduled = Date.parse("2026-09-28T04:15:00.000Z");
    expect(isHourlyMasterDataPass(scheduled)).toBe(
      isHourlyMasterDataPass(scheduled)
    );
    expect(isHourlyMasterDataPass(scheduled)).toBe(true);
  });

  it("splits on the half hour, whatever the process timezone", () => {
    expect(at("2026-09-28T00:00:00.000Z")).toBe(true);
    expect(at("2026-09-28T00:29:59.999Z")).toBe(true);
    expect(at("2026-09-28T00:30:00.000Z")).toBe(false);
    expect(at("2026-09-28T00:59:59.999Z")).toBe(false);
  });
});
