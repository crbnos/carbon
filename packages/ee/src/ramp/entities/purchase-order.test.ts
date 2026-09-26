import { describe, expect, it } from "vitest";
import {
  RAMP_PURCHASE_ORDER_NUMBER_SUFFIX,
  toRampPurchaseOrderNumber
} from "./purchase-order";

/**
 * Ramp's `purchase_order_number` handling, mapped live against the sandbox on
 * 2026-09-26 and documented nowhere:
 *
 * | sent          | stored          |
 * |---------------|-----------------|
 * | `PO000002`    | `2`             |
 * | `PO999999`    | `999999`        |
 * | `PO000123`    | `123`           |
 * | `PO-000004`   | rejected (→ `4`)|
 * | `PO000004-1`  | `PO000004-1`    |
 * | `PO000004-A`  | `PO000004-A-1`  |
 *
 * Uniqueness is enforced on the REDUCED value, which is why an unsuffixed Carbon
 * readable id collides with whatever the customer's Ramp account already holds.
 */
describe("toRampPurchaseOrderNumber", () => {
  it("keeps the Carbon readable id recognisable", () => {
    expect(toRampPurchaseOrderNumber("PO000004")).toBe("PO000004-1");
    expect(toRampPurchaseOrderNumber("PO123456")).toBe("PO123456-1");
  });

  it("appends a NUMERIC suffix", () => {
    // A non-numeric tail does not survive: Ramp stored `PO000004-A` as
    // `PO000004-A-1`, appending its own. Only a numeric suffix round-trips, so
    // what Carbon sends is what a human sees.
    expect(RAMP_PURCHASE_ORDER_NUMBER_SUFFIX).toMatch(/^-\d+$/);
  });

  it("leaves Carbon's readable-id format in a form Ramp stores verbatim", () => {
    // VERIFIED, not derived. Ramp's transform could not be reduced to a rule by
    // probing — `PO-2026-003` came back `2026-3` (leading `PO-` dropped, trailing
    // zeros dropped) while `PO000004-1` came back untouched, and the two are not
    // reconcilable into one predicate. So this pins the case that was actually
    // exercised: Carbon's own `PO` + six digits, which is what the sequence emits
    // by default, suffixed.
    expect(toRampPurchaseOrderNumber("PO000004")).toBe("PO000004-1");
    // `PO000004-1` was accepted and stored verbatim against a Ramp business where
    // the number `4` was already taken — twice, including after the first was
    // archived.
  });

  it("is deterministic, so a re-push addresses the same Ramp document", () => {
    // `upsertRemote` finds an existing purchase order by `external_id`, not by
    // number — but a number that changed between pushes would still rename the
    // customer's document under them on every sync.
    expect(toRampPurchaseOrderNumber("PO000004")).toBe(
      toRampPurchaseOrderNumber("PO000004")
    );
  });
});
