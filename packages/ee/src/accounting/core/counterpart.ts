/**
 * The counterpart ladder — "is this local record already on the provider?"
 *
 * One shared implementation of a decision three providers had independently
 * reinvented (Xero contacts by name, QuickBooks by `DisplayName`, Ramp spend
 * vendors by `external_vendor_id` then name) and a fourth had simply skipped
 * (Rillet, which created unconditionally).
 *
 * How wide the candidate set is stays the PROVIDER's business, and it differs:
 * Rillet has no search endpoint, so it lists the org and every rung is live;
 * Xero and QuickBooks query by name, so their candidates are name-bounded and
 * name is the only rung that can decide. Widening those means widening the
 * query, not passing more keys — a set already filtered to one name cannot be
 * resolved by email.
 *
 * The ladder, strongest key first:
 *
 *   carbonReference -> taxId -> email -> name
 *
 * The FIRST rung with exactly ONE match wins. A rung with two or more matches
 * does NOT fall through to a weaker rung — it stops and creates.
 *
 * **Ambiguity creates, it never guesses.** A duplicate is recoverable: a human
 * merges two vendors. A wrong link is not — it silently posts one company's
 * bills against another company's vendor, and nothing in the system will flag
 * it. So when two remote records answer to the same name, the safe move is a
 * third record, not a coin flip. `resolveOrCreateRampSpendVendor` reached the
 * same conclusion independently ("a shared name is not an identity key").
 *
 * Falling through from an ambiguous strong key to a weaker one would be worse
 * than either: two records sharing a tax id but differing in name would link by
 * name, which is exactly the wrong answer for the strongest evidence available.
 */

import type {
  CounterpartSearchKeys,
  ExternalIdentityKind,
  RemoteCandidate
} from "./counterpart-types";
import { type BaseProvider, providerSupportsCounterpartSearch } from "./types";

/** The rungs, in descending order of how strongly they identify a record. */
const LADDER = ["carbonReference", "taxId", "email", "name"] as const;

export type CounterpartRung = (typeof LADDER)[number];

export type CounterpartDecision =
  | { action: "link"; remoteId: string; via: CounterpartRung }
  | {
      action: "create";
      reason: "no-candidates" | "ambiguous";
      rung?: CounterpartRung;
    };

/** Trimmed, lower-cased, or null when absent/blank. A blank key matches nothing. */
function normalize(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Decide, given candidates the provider already returned. Pure — no I/O, so the
 * ladder's semantics are unit-testable without a provider.
 */
export function decideCounterpart(
  keys: CounterpartSearchKeys,
  candidates: readonly RemoteCandidate[]
): CounterpartDecision {
  for (const rung of LADDER) {
    const wanted = normalize(keys[rung]);
    if (!wanted) continue;

    const matches = candidates.filter(
      (candidate) => normalize(candidate[rung]) === wanted
    );

    if (matches.length === 1) {
      const match = matches[0];
      if (match) return { action: "link", remoteId: match.remoteId, via: rung };
    }

    // Two or more on the strongest key that answered: stop here rather than
    // trying a weaker one. See the header — falling through would resolve by
    // weaker evidence than the evidence that just proved ambiguous.
    if (matches.length > 1) {
      return { action: "create", reason: "ambiguous", rung };
    }
  }

  return { action: "create", reason: "no-candidates" };
}

/**
 * Resolve a local record to its remote counterpart, running the provider's
 * search when it declares one.
 *
 * Returns `remoteId: null` to mean "create it" — this function NEVER creates.
 * The caller owns creation because each provider's create call differs
 * (idempotency keys, payload shape, sync-token retries) and because the caller
 * is the one that must write the mapping row afterwards.
 */
export async function resolveOrCreateRemoteCounterpart(args: {
  provider: BaseProvider;
  kind: ExternalIdentityKind;
  keys: CounterpartSearchKeys;
  /** An existing mapping row's remote id, if any — the zeroth rung. */
  existingRemoteId: string | null;
}): Promise<{ remoteId: string | null; decision: CounterpartDecision | null }> {
  if (args.existingRemoteId) {
    return { remoteId: args.existingRemoteId, decision: null };
  }

  if (!providerSupportsCounterpartSearch(args.provider, args.kind)) {
    return {
      remoteId: null,
      decision: { action: "create", reason: "no-candidates" }
    };
  }

  const candidates = await args.provider.findRemoteCandidates(
    args.kind,
    args.keys
  );
  const decision = decideCounterpart(args.keys, candidates);

  return {
    remoteId: decision.action === "link" ? decision.remoteId : null,
    decision
  };
}
