// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, BLOCKED, halt, type Model, type Step } from "./explore";

/**
 * Posting and voiding one receipt, shipment or purchase invoice. The post is
 * the operation (`postReceipt` / `postShipment` in
 * `apps/erp/app/modules/inventory/inventory.server.ts`, `postPurchaseInvoice`
 * in `invoicing.server.ts`): a status read, the claim to Pending, then the
 * posting (`postReceipt` / `postShipment` in `inventory.service.ts`,
 * `postPurchaseInvoice` in `invoicing.service.ts`), whose failure handler
 * returns the document to Draft. A retry is the posting called again on its
 * own, as a step retry or `api/internal/postings` does: it has no claim.
 * The ledger counts one per committed post and minus one per reversal.
 */

export type Status = "Draft" | "Pending" | "Posted" | "Voided";

export type State = {
  status: Status;
  ledger: number;
  posts: number;
  voids: number;
  /** The document's row lock, by the actor whose transaction holds it. */
  lock: string | null;
  /** Actors whose posting refused or failed: they run the failure handler. */
  failed: Record<string, true>;
  pending: Record<string, { ledger: number; status: Status | null }>;
};

/** Each switch is one fix; the test replays the bug each one closed. */
export type Protocol = {
  /** 019f07fb9b: the operation and the posting refuse a Voided document. */
  refuseVoided: boolean;
  /** bbe8dfd6a9: the claim is guarded on the status (not Voided); zero rows refuse. */
  guardedClaim: boolean;
  /** 97dbe6d8c5: the claim and the posting's `assertPostable` take only Draft or Pending, and the operation refuses Posted. */
  postableOnly: boolean;
  /** The claim takes only a Draft, as the sales invoice's does. */
  claimDraftOnly: boolean;
  /** `lockPostable`: the posting's transaction locks the document first and re-checks Draft or Pending. */
  lockOnPost: boolean;
  /** The posting's failure handler returns the document to Draft only from Pending. */
  postingResetOnlyFromPending: boolean;
  /** The operation's return to Draft, after the posting or after a failure past its commit, only from Pending. */
  operationResetOnlyFromPending: boolean;
  /** `lockPostedReceipt` / `lockPostedShipment`: the void's transaction locks the document first and re-checks Posted. */
  lockOnVoid: boolean;
};

/** The receipt and the shipment. */
export const SHIPPED: Protocol = {
  refuseVoided: true,
  guardedClaim: true,
  postableOnly: true,
  claimDraftOnly: false,
  lockOnPost: true,
  postingResetOnlyFromPending: true,
  operationResetOnlyFromPending: true,
  lockOnVoid: true
};

export const SHIPPED_PURCHASE_INVOICE: Protocol = {
  ...SHIPPED,
  claimDraftOnly: true
};

export const invariants: Model<State>["invariants"] = {
  "a document is never Posted after Voided": (s) =>
    s.voids === 0 || s.status !== "Posted",
  "a document is posted at most once": (s) => s.posts <= 1,
  "a document is never voided twice": (s) => s.voids <= 1,
  "its ledger nets to its posted state": (s) =>
    s.ledger === (s.status === "Posted" ? 1 : 0)
};

export function initialState(status: Status = "Draft"): State {
  const posted = status === "Posted" || status === "Voided";
  return {
    status,
    ledger: status === "Posted" ? 1 : 0,
    posts: posted ? 1 : 0,
    voids: status === "Voided" ? 1 : 0,
    lock: null,
    failed: {},
    pending: {}
  };
}

function end(s: State, actor: string): State {
  const { [actor]: _p, ...pending } = s.pending;
  return { ...s, pending, lock: s.lock === actor ? null : s.lock };
}

function fail(s: State, actor: string): State {
  return { ...end(s, actor), failed: { ...s.failed, [actor]: true } };
}

const held = (s: State, actor: string) => s.lock !== null && s.lock !== actor;

function postable(protocol: Protocol, status: Status): boolean {
  if (protocol.postableOnly) return status === "Draft" || status === "Pending";
  return !(protocol.refuseVoided && status === "Voided");
}

/** An autocommit UPDATE of the row: waits for its lock, then applies at once. */
function update(
  s: State,
  actor: string,
  where: (status: Status) => boolean,
  status: Status
): State | typeof BLOCKED | null {
  if (held(s, actor)) return BLOCKED;
  return where(s.status) ? { ...s, status } : null;
}

function resetToDraft(
  label: string,
  name: string,
  onlyFromPending: boolean
): Step<State> {
  return {
    label: `${label}: UPDATE status = Draft${onlyFromPending ? " WHERE Pending" : ""}`,
    run: (s) => {
      if (!s.failed[name]) return s;
      const reset = update(
        s,
        name,
        (status) => !onlyFromPending || status === "Pending",
        "Draft"
      );
      return reset === BLOCKED ? BLOCKED : (reset ?? s);
    }
  };
}

type PostKind = "post" | "retry" | "postFails" | "postLateFailure";

/** The posting, from its `assertPostable` read to its failure handler. */
function posting(protocol: Protocol, name: string, kind: PostKind) {
  const skip = (s: State) => Boolean(s.failed[name]);
  const steps: Step<State>[] = [];
  if (protocol.refuseVoided || protocol.postableOnly) {
    steps.push({
      label: "read the document: refuse unless postable",
      run: (s) => (postable(protocol, s.status) ? s : halt(s))
    });
  }
  if (protocol.lockOnPost) {
    steps.push({
      label: "lock the document FOR UPDATE: refuse unless Draft or Pending",
      run: (s) => {
        if (held(s, name)) return BLOCKED;
        const locked = { ...s, lock: name };
        return locked.status === "Draft" || locked.status === "Pending"
          ? locked
          : fail(locked, name);
      }
    });
  }
  steps.push(
    {
      label: "write the ledger, cost layers and journal",
      run: (s) => {
        if (skip(s)) return s;
        if (kind === "postFails") return fail(s, name);
        return {
          ...s,
          pending: { ...s.pending, [name]: { ledger: 1, status: null } }
        };
      }
    },
    {
      label: "UPDATE status = Posted",
      run: (s) => {
        if (skip(s)) return s;
        if (held(s, name)) return BLOCKED;
        const mine = s.pending[name] ?? { ledger: 0, status: null };
        return {
          ...s,
          lock: name,
          pending: { ...s.pending, [name]: { ...mine, status: "Posted" } }
        };
      }
    },
    {
      label: "commit",
      run: (s) => (skip(s) ? s : commit(s, name))
    },
    resetToDraft(
      "the posting's failure handler",
      name,
      protocol.postingResetOnlyFromPending
    )
  );
  return steps;
}

function commit(s: State, actor: string): State {
  const mine = s.pending[actor];
  if (!mine) return end(s, actor);
  return end(
    {
      ...s,
      status: mine.status ?? s.status,
      ledger: s.ledger + mine.ledger,
      posts: s.posts + (mine.ledger > 0 ? 1 : 0),
      voids: s.voids + (mine.ledger < 0 ? 1 : 0)
    },
    actor
  );
}

export function post(
  protocol: Protocol,
  name = "Post",
  kind: Exclude<PostKind, "retry"> = "post"
): Actor<State> {
  const steps: Step<State>[] = [];
  if (protocol.refuseVoided || protocol.postableOnly) {
    steps.push({
      label: "read the document: refuse Posted or Voided",
      run: (s) => {
        if (s.status === "Voided") return halt(s);
        return protocol.postableOnly && s.status === "Posted" ? halt(s) : s;
      }
    });
  }
  steps.push({
    label: "claim: UPDATE status = Pending",
    run: (s) => {
      const claimed = update(
        s,
        name,
        (status) => {
          if (protocol.claimDraftOnly) return status === "Draft";
          if (protocol.postableOnly) {
            return status === "Draft" || status === "Pending";
          }
          return !protocol.guardedClaim || status !== "Voided";
        },
        "Pending"
      );
      if (claimed === BLOCKED) return BLOCKED;
      return claimed ?? halt(s);
    }
  });
  steps.push(...posting(protocol, name, kind));
  steps.push({
    label:
      kind === "postLateFailure"
        ? "the request fails after the commit: return the document to Draft"
        : "the operation returns a failed post to Draft",
    run: (s) => {
      const failedAfterCommit = kind === "postLateFailure" && !s.failed[name];
      if (!s.failed[name] && !failedAfterCommit) return s;
      const reset = update(
        s,
        name,
        (status) =>
          !protocol.operationResetOnlyFromPending || status === "Pending",
        "Draft"
      );
      return reset === BLOCKED ? BLOCKED : (reset ?? s);
    }
  });
  return { name, steps };
}

export function retry(protocol: Protocol, name = "Retry"): Actor<State> {
  return { name, steps: posting(protocol, name, "retry") };
}

export function voidDocument(protocol: Protocol, name = "Void"): Actor<State> {
  const refuseUnlessPosted: Step<State>["run"] = (s) =>
    s.status === "Posted" ? s : halt(s);
  const steps: Step<State>[] = [
    {
      label: "the operation reads the document: refuse unless Posted",
      run: refuseUnlessPosted
    },
    {
      label: "the posting reads the document: refuse unless Posted",
      run: refuseUnlessPosted
    }
  ];
  if (protocol.lockOnVoid) {
    steps.push({
      label: "lock the document FOR UPDATE: refuse unless Posted",
      run: (s) => {
        if (held(s, name)) return BLOCKED;
        return s.status === "Posted"
          ? { ...s, lock: name }
          : halt(end(s, name));
      }
    });
  }
  steps.push(
    {
      label: "write the reversal",
      run: (s) => ({
        ...s,
        pending: { ...s.pending, [name]: { ledger: -1, status: null } }
      })
    },
    {
      label: "UPDATE status = Voided",
      run: (s) => {
        if (held(s, name)) return BLOCKED;
        const mine = s.pending[name] ?? { ledger: 0, status: null };
        return {
          ...s,
          lock: name,
          pending: { ...s.pending, [name]: { ...mine, status: "Voided" } }
        };
      }
    },
    { label: "commit", run: (s) => commit(s, name) }
  );
  return { name, steps };
}

export type Operation =
  | "post"
  | "retry"
  | "void"
  | "postFails"
  | "postLateFailure";

const NAMES: Record<Operation, string> = {
  post: "Post",
  retry: "Retry",
  void: "Void",
  postFails: "FailingPost",
  postLateFailure: "LateFailingPost"
};

export function documentPostingModel(
  start: Status,
  operations: Operation[],
  protocol: Protocol
): Model<State> {
  return {
    init: initialState(start),
    actors: operations.map((op, k) => {
      const name = `${NAMES[op]}#${k + 1}`;
      if (op === "void") return voidDocument(protocol, name);
      if (op === "retry") return retry(protocol, name);
      return post(protocol, name, op);
    }),
    invariants
  };
}
