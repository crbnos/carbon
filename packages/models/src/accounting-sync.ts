// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, BLOCKED, halt, type Model, type Step } from "./explore";

/**
 * Pushing one Carbon record to Xero or QuickBooks through the sync ledger, as
 * `drainSyncOperations` (`packages/jobs/.../accounting-sync-operations.ts`)
 * runs the syncers (`packages/ee/src/accounting`), and one day's summary
 * journal as `consolidateIntegration` (`accounting-consolidation.ts`) pushes it.
 *
 * Three kinds of record:
 * - a document (journal, invoice, bill, payment): created once, never edited;
 * - master data (customer, vendor): created, then updated after each edit.
 *   Both providers' syncers look an existing counterpart up by name before
 *   creating one (`resolveOrCreateRemoteCounterpart`);
 * - a daily summary: one journal per batch marker.
 *
 * Time: Xero replays a create key for six minutes. A stale reclaim, a
 * person's Retry and the next day's consolidation come ten or more minutes
 * after the attempt they follow, so each starts with "ten minutes pass",
 * which forgets Xero's keys. QuickBooks' `requestid` is modelled as kept for
 * as long as the retries come, as the repo treats it.
 */

export type Kind = "document" | "master" | "summary";
export type Provider = "xero" | "qbo";
type Status = "Pending" | "In Flight" | "Completed" | "Failed";

type Version = { version: number; name: number };

type Attempt = {
  n: number;
  read: Version;
  doc: number | null;
  /** The fast bailout: the record is unchanged since the mapping's version. */
  unchanged: boolean;
  /** The create reached the provider and its response was lost. */
  lost: boolean;
  /** Between its lookup and its create: two adjacent requests. */
  inWindow: boolean;
};

export type State = {
  status: Status;
  attemptCount: number;
  /** The attempt whose close set a terminal status. */
  closedBy: number | null;
  /** The record as Carbon holds it: `updatedAt`, and its name. */
  local: Version;
  /** The provider's documents for the record, as each was last written. */
  remote: Version[];
  /** The create key the provider still replays, and the document it made. */
  replay: { key: string; doc: number } | null;
  mapping: { doc: number; synced: number } | null;
  /** The summary push the batch marker recorded before its create. */
  recorded: boolean;
  attempts: Record<string, Attempt>;
};

/** Each switch is one fix; the test replays the bug each one closed. */
export type Protocol = {
  /** 516f214690: a create sends a key from the Carbon id (`remoteCreateKey`). */
  createKey: boolean;
  /** 516f214690: a Xero document create first looks the document up by the reference Carbon writes on it. */
  lookupBeforeCreate: boolean;
  /** dac4d0f75f: a close matches the attemptCount its claim stamped (`updateHeldOperation`). */
  fencedClose: boolean;
  /** 7a87454474: a push links with the `updatedAt` it read (`getPushedVersion`), not the link time. */
  versionedLink: boolean;
  /** 93c97eca28: an editable record's create key covers what is sent (`editableCreateKey`). */
  editableKeyByContent: boolean;
  /** 61638a586c: the consolidation records its push on the marker before the create, and a later run looks the summary up by it. */
  recordSummaryPush: boolean;
};

export const SHIPPED: Protocol = {
  createKey: true,
  lookupBeforeCreate: true,
  fencedClose: true,
  versionedLink: true,
  editableKeyByContent: true,
  recordSummaryPush: true
};

export const invariants: Model<State>["invariants"] = {
  "each Carbon record has at most one remote document": (s) =>
    s.remote.length <= 1,
  "a closed operation reflects the newest attempt": (s) =>
    s.status === "Pending" ||
    s.status === "In Flight" ||
    s.closedBy === s.attemptCount,
  "the mapping's synced version never hides an unpushed edit": (s) =>
    !s.mapping ||
    s.mapping.synced < s.local.version ||
    (s.remote[s.mapping.doc]?.version ?? -1) >= s.local.version
};

export function initialState(): State {
  return {
    status: "Pending",
    attemptCount: 0,
    closedBy: null,
    local: { version: 0, name: 0 },
    remote: [],
    replay: null,
    mapping: null,
    recorded: false,
    attempts: {}
  };
}

type Config = { kind: Kind; provider: Provider; protocol: Protocol };

function withAttempt(s: State, actor: string, patch: Partial<Attempt>): State {
  const current = s.attempts[actor];
  if (!current) return s;
  return {
    ...s,
    attempts: { ...s.attempts, [actor]: { ...current, ...patch } }
  };
}

/**
 * Xero forgets its create keys. Not while an attempt is between its lookup
 * and its create: those are adjacent requests, and an attempt that stalls six
 * minutes between them is outside the model.
 */
const tenMinutesPass = (config: Config): Step<State> => ({
  label: "ten minutes pass",
  run: (s) => {
    if (Object.values(s.attempts).some((attempt) => attempt.inWindow)) {
      return BLOCKED;
    }
    return config.provider === "xero" ? { ...s, replay: null } : s;
  }
});

/** `claimPendingOperations`: the CAS on status and attemptCount. A reclaim also takes a stale In Flight row. */
function claim(actor: string, reclaim: boolean): Step<State> {
  return {
    label: reclaim
      ? "claim the Pending or stale In Flight operation"
      : "claim the Pending operation",
    run: (s) => {
      const claimable =
        s.status === "Pending" || (reclaim && s.status === "In Flight");
      if (!claimable) return halt(s);
      const n = s.attemptCount + 1;
      return {
        ...s,
        status: "In Flight",
        attemptCount: n,
        closedBy: null,
        attempts: {
          ...s.attempts,
          [actor]: {
            n,
            read: s.local,
            doc: null,
            unchanged: false,
            lost: false,
            inWindow: false
          }
        }
      };
    }
  };
}

/** Xero's contact create sends no key; every other create does once the switch is on. */
function sendsKey(config: Config): boolean {
  return (
    config.protocol.createKey &&
    !(config.kind === "master" && config.provider === "xero")
  );
}

function keyOf(config: Config, sent: Version): string {
  return config.kind === "master" && config.protocol.editableKeyByContent
    ? `record:${sent.version}:${sent.name}`
    : "record";
}

/** The provider create: a key it still replays answers with the document it made. */
function create(config: Config, s: State, sent: Version) {
  const key = keyOf(config, sent);
  if (sendsKey(config) && s.replay?.key === key) {
    return { s, doc: s.replay.doc };
  }
  const doc = s.remote.length;
  return {
    s: {
      ...s,
      remote: [...s.remote, sent],
      replay: sendsKey(config) ? { key, doc } : s.replay
    },
    doc
  };
}

function close(config: Config, actor: string): Step<State> {
  return {
    label: "close the operation",
    run: (s) => {
      const attempt = s.attempts[actor];
      if (!attempt) return s;
      if (config.protocol.fencedClose && s.attemptCount !== attempt.n) {
        return s;
      }
      return {
        ...s,
        status: attempt.lost ? "Failed" : "Completed",
        closedBy: attempt.n
      };
    }
  };
}

type Fate = "deliver" | "lose" | "die";

function looksUp(config: Config): boolean {
  if (config.kind === "master") return true;
  return config.provider === "xero" && config.protocol.lookupBeforeCreate;
}

/** One drain attempt on a document or master record: the syncer's push, then the close. */
function drainAttempt(
  config: Config,
  actor: string,
  options: { reclaim: boolean; fate: Fate; before?: Step<State>[] }
): Actor<State> {
  const steps: Step<State>[] = [...(options.before ?? [])];
  steps.push(claim(actor, options.reclaim), {
    label: "read the record and its mapping",
    run: (s) =>
      withAttempt(s, actor, {
        read: s.local,
        doc: s.mapping?.doc ?? null,
        unchanged:
          config.kind === "master" &&
          !!s.mapping &&
          s.local.version <= s.mapping.synced
      })
  });
  if (looksUp(config)) {
    steps.push({
      label:
        config.kind === "master"
          ? "look the counterpart up by name"
          : "look the document up by the reference Carbon writes on it",
      run: (s) => {
        const attempt = s.attempts[actor];
        if (!attempt || attempt.doc !== null) return s;
        const found = s.remote.findIndex(
          (doc) => config.kind !== "master" || doc.name === attempt.read.name
        );
        return withAttempt(s, actor, {
          inWindow: true,
          ...(found < 0 ? {} : { doc: found })
        });
      }
    });
  }
  steps.push({
    label:
      options.fate === "lose"
        ? "create or update the remote document; the response is lost"
        : "create or update the remote document",
    run: (s) => {
      const attempt = s.attempts[actor];
      if (!attempt) return s;
      if (attempt.unchanged) return withAttempt(s, actor, { inWindow: false });
      let next = s;
      let doc = attempt.doc;
      if (doc === null) {
        const created = create(config, s, attempt.read);
        next = created.s;
        doc = created.doc;
      } else if (config.kind === "master") {
        const target = doc;
        next = {
          ...s,
          remote: s.remote.map((v, i) => (i === target ? attempt.read : v))
        };
      }
      const after = withAttempt(next, actor, {
        doc: options.fate === "lose" ? null : doc,
        lost: options.fate === "lose",
        inWindow: false
      });
      return options.fate === "die" ? halt(after) : after;
    }
  });
  steps.push(
    {
      label: "link the mapping",
      run: (s) => {
        const attempt = s.attempts[actor];
        if (!attempt || attempt.lost || attempt.unchanged) return s;
        if (attempt.doc === null) return s;
        return {
          ...s,
          mapping: {
            doc: attempt.doc,
            synced: config.protocol.versionedLink
              ? attempt.read.version
              : s.local.version
          }
        };
      }
    },
    close(config, actor)
  );
  return { name: actor, steps };
}

/** A person's Retry in Sync Activity: Failed → Pending. */
function retry(config: Config, actor: string): Actor<State> {
  return {
    name: actor,
    steps: [
      tenMinutesPass(config),
      {
        label: "retry the Failed operation",
        run: (s) =>
          s.status === "Failed" ? { ...s, status: "Pending" } : halt(s)
      }
    ]
  };
}

function edit(actor: string, rename: boolean): Actor<State> {
  return {
    name: actor,
    steps: [
      {
        label: rename
          ? "a person renames the record"
          : "a person edits the record",
        run: (s) => ({
          ...s,
          local: {
            version: s.local.version + 1,
            name: s.local.name + (rename ? 1 : 0)
          }
        })
      }
    ]
  };
}

/** The outbound sweep: `reconcileMasterData`, then a drain of what it enqueued. */
function sweep(config: Config, actor: string): Actor<State> {
  return drainAttempt(config, actor, {
    reclaim: false,
    fate: "deliver",
    before: [
      {
        label:
          "reconcile: enqueue when nothing is live and the record changed since its mapping",
        run: (s) => {
          const live = s.status === "Pending" || s.status === "In Flight";
          const changed = !s.mapping || s.local.version > s.mapping.synced;
          if (live || !changed) return halt(s);
          return { ...s, status: "Pending", closedBy: null };
        }
      }
    ]
  });
}

/** One run of the daily consolidation for one batch marker. */
function consolidation(
  config: Config,
  actor: string,
  options: { nextDay: boolean; fate: "deliver" | "die" }
): Actor<State> {
  const steps: Step<State>[] = [];
  if (options.nextDay) steps.push(tenMinutesPass(config));
  steps.push(claim(actor, options.nextDay));
  if (config.protocol.recordSummaryPush) {
    steps.push(
      {
        label: "look the summary up by the push the marker recorded",
        run: (s) =>
          withAttempt(s, actor, {
            inWindow: true,
            ...(s.recorded && s.remote.length > 0 ? { doc: 0 } : {})
          })
      },
      {
        label: "record the push on the marker",
        run: (s) => {
          const attempt = s.attempts[actor];
          if (!attempt || attempt.doc !== null) return s;
          if (config.protocol.fencedClose && s.attemptCount !== attempt.n) {
            return halt(withAttempt(s, actor, { inWindow: false }));
          }
          return { ...s, recorded: true };
        }
      }
    );
  }
  steps.push(
    {
      label: "create the summary journal",
      run: (s) => {
        const attempt = s.attempts[actor];
        if (!attempt) return s;
        if (attempt.doc !== null) {
          return withAttempt(s, actor, { inWindow: false });
        }
        const created = create(config, s, attempt.read);
        const after = withAttempt(created.s, actor, {
          doc: created.doc,
          inWindow: false
        });
        return options.fate === "die" ? halt(after) : after;
      }
    },
    close(config, actor)
  );
  return { name: actor, steps };
}

export type Operation =
  | "drain"
  | "drainLost"
  | "drainDies"
  | "reclaim"
  | "retry"
  | "edit"
  | "rename"
  | "sweep"
  | "consolidate"
  | "consolidateDies"
  | "nextDay";

export function accountingSyncModel(
  kind: Kind,
  provider: Provider,
  operations: Operation[],
  protocol: Protocol = SHIPPED
): Model<State> {
  const config: Config = { kind, provider, protocol };
  const build: Record<Operation, (name: string) => Actor<State>> = {
    drain: (name) =>
      drainAttempt(config, name, { reclaim: false, fate: "deliver" }),
    drainLost: (name) =>
      drainAttempt(config, name, { reclaim: false, fate: "lose" }),
    drainDies: (name) =>
      drainAttempt(config, name, { reclaim: false, fate: "die" }),
    reclaim: (name) =>
      drainAttempt(config, name, {
        reclaim: true,
        fate: "deliver",
        before: [tenMinutesPass(config)]
      }),
    retry: (name) => retry(config, name),
    edit: (name) => edit(name, false),
    rename: (name) => edit(name, true),
    sweep: (name) => sweep(config, name),
    consolidate: (name) =>
      consolidation(config, name, { nextDay: false, fate: "deliver" }),
    consolidateDies: (name) =>
      consolidation(config, name, { nextDay: false, fate: "die" }),
    nextDay: (name) =>
      consolidation(config, name, { nextDay: true, fate: "deliver" })
  };
  return {
    init: initialState(),
    actors: operations.map((op, k) => build[op](`${op}#${k + 1}`)),
    invariants
  };
}

/**
 * The operations each kind's search draws from. Master data leaves out two
 * cases that stay open (see the model's "Not covered" in the skill): a
 * reclaim overlapping a live push of the same record, whose older payload can
 * land after the newer one, and a rename between a lost create and its retry.
 */
export const OPERATIONS: Record<Kind, Operation[]> = {
  document: ["drain", "drainLost", "drainDies", "reclaim", "retry"],
  master: ["drain", "drainLost", "drainDies", "retry", "edit", "sweep"],
  summary: ["consolidate", "consolidateDies", "nextDay"]
};
