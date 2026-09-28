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
 *
 * **A single match is not enough — it must also be UNCLAIMED.** Two suppliers
 * for one legal entity share a tax id, so pushing the second matches exactly
 * one candidate: the vendor the FIRST supplier is already mapped to. Adopting
 * it and then updating it overwrites that vendor's name, email and tax id while
 * every bill of the first supplier still points at it, and the mapping's
 * partial unique index only refuses AFTERWARDS. So the caller passes
 * `isClaimed` and a claimed match creates, exactly as an ambiguous one does.
 */

import { getLogger } from "@carbon/logger";
import type {
  CounterpartSearchKeys,
  ExternalIdentityKind,
  RemoteCandidate
} from "./counterpart-types";
import { type BaseProvider, providerSupportsCounterpartSearch } from "./types";

const logger = getLogger("ee", "accounting-counterpart");

/** The rungs, in descending order of how strongly they identify a record. */
const LADDER = ["carbonReference", "taxId", "email", "name"] as const;

export type CounterpartRung = (typeof LADDER)[number];

/**
 * Why the ladder chose to create.
 *
 * - `not-searchable` — the provider declares no search for this kind, so
 *   NOTHING was looked at. Distinct from `no-candidates` on purpose: the two
 *   used to be the same string, which made "Rillet cannot search items" read
 *   exactly like "we searched and the vendor is genuinely new".
 * - `no-candidates` — searched, and nothing answered any key.
 * - `ambiguous` — two or more records answered the strongest key that answered.
 * - `claimed` — exactly one record answered, but it is already mapped to a
 *   DIFFERENT local record of this kind, so adopting it would re-point one
 *   party's provider master at another's.
 */
export type CounterpartCreateReason =
  | "not-searchable"
  | "no-candidates"
  | "ambiguous"
  | "claimed";

export type CounterpartDecision =
  | { action: "link"; remoteId: string; via: CounterpartRung }
  | {
      action: "create";
      reason: CounterpartCreateReason;
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
  /** The local record being resolved — logging context only. */
  localId?: string;
  /**
   * Is this remote id already mapped to a DIFFERENT local record of this kind
   * in this company? The caller owns the question because it owns the mapping
   * service and knows its own local id.
   *
   * **Pass it.** Without it the ladder can hand back a remote record another
   * party already owns, and a caller that updates before it links (the Rillet
   * vendor syncer did) overwrites that party's provider master — name, email,
   * tax id — with every one of its bills still pointing at the record. The
   * mapping's partial unique index refuses the link AFTERWARDS, so the
   * operation closes Failed with the damage already done and no revert.
   *
   * Optional only so the four existing callers keep compiling; a caller that
   * omits it gets the old, unsafe behaviour.
   */
  isClaimed?: (remoteId: string) => Promise<boolean>;
}): Promise<{ remoteId: string | null; decision: CounterpartDecision | null }> {
  if (args.existingRemoteId) {
    return { remoteId: args.existingRemoteId, decision: null };
  }

  if (!providerSupportsCounterpartSearch(args.provider, args.kind)) {
    return {
      remoteId: null,
      decision: logDecision(args, {
        action: "create",
        reason: "not-searchable"
      })
    };
  }

  const candidates = await args.provider.findRemoteCandidates(
    args.kind,
    args.keys
  );
  const decision = decideCounterpart(args.keys, candidates);

  if (decision.action === "link" && args.isClaimed) {
    if (await args.isClaimed(decision.remoteId)) {
      return {
        remoteId: null,
        decision: logDecision(args, {
          action: "create",
          reason: "claimed",
          rung: decision.via
        })
      };
    }
  }

  return {
    remoteId: decision.action === "link" ? decision.remoteId : null,
    decision: logDecision(args, decision, candidates.length)
  };
}

/**
 * Every caller destructures `{ remoteId }` and drops the decision, so the only
 * record that ambiguity (or a claimed record) fired is this line. Without it a
 * duplicated vendor is indistinguishable from a genuinely new one.
 */
function logDecision(
  args: { kind: ExternalIdentityKind; localId?: string },
  decision: CounterpartDecision,
  candidateCount?: number
): CounterpartDecision {
  const context = {
    kind: args.kind,
    localId: args.localId,
    ...(candidateCount === undefined ? {} : { candidateCount })
  };

  if (decision.action === "link") {
    logger.info("Counterpart adopted an existing remote record", {
      ...context,
      remoteId: decision.remoteId,
      via: decision.via
    });
    return decision;
  }

  // `ambiguous` and `claimed` are the two that produce a DUPLICATE on the
  // provider, so they are warnings; the other two are ordinary.
  const message = "Counterpart will create a new remote record";
  const payload = { ...context, reason: decision.reason, rung: decision.rung };
  if (decision.reason === "ambiguous" || decision.reason === "claimed") {
    logger.warn(message, payload);
  } else {
    logger.info(message, payload);
  }
  return decision;
}
