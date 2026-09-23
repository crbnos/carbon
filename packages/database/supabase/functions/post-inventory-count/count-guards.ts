// Pure decision for how a counted tracked entity's quantity and status settle.
// A count books its ledger delta from the SNAPSHOT taken when the count was
// generated; the entity's live quantity may have moved since. Applying the same
// delta to the live quantity keeps entity and ledger in step — but if that lands
// below zero the two have genuinely diverged, so we refuse (recount) rather than
// clamp, which would desync the entity from the already-booked ledger delta.

import { settleQuantity } from "../shared/entity-drain.ts";

export function resolveCountedEntity<S extends string>(input: {
  currentQuantity: number;
  delta: number;
  currentStatus: S;
}): { quantity: number; status: S | "Consumed" } {
  return settleQuantity({
    quantity: input.currentQuantity + input.delta,
    status: input.currentStatus,
    refusal:
      "Stock moved since the count was taken; recount this line before posting",
  });
}
