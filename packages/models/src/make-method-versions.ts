// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, BLOCKED, halt, type Model, type Step } from "./explore";

/**
 * The status of one item's make method versions (Draft / Active / Archived),
 * as four writers change it or write into it:
 * - activation, the `methodVersionToActive` case of `convertDocument`
 *   (`apps/erp/app/modules/shared/shared.service.ts`), also behind a change
 *   notice's release;
 * - the method import, `writeGroup` (same file), into one or more versions;
 * - the Onshape sync, `syncMakeMethod`
 *   (`apps/erp/app/modules/items/items.service.ts`), into a Draft;
 * - a new version that sets its source Active, `createMakeMethodVersion`
 *   (same file).
 *
 * Versions `v1` < `v2` < `v3` in id order. A lock is the version's row lock;
 * every mode taken here (UPDATE, FOR NO KEY UPDATE) conflicts with the
 * others. Not modelled: the BOM lines that point at a version (activation
 * re-points them, an import or sync inserts them; their foreign key takes KEY
 * SHARE, which no lock here conflicts with), the new Draft a new version
 * inserts (no one else sees it before the commit), the sync's sub-assemblies,
 * and the BOM editor, which writes through PostgREST without a transaction.
 */

export const VERSIONS = ["v1", "v2", "v3"] as const;
export type Version = (typeof VERSIONS)[number];
export type Status = "Draft" | "Active" | "Archived";

export type State = {
  status: Record<Version, Status>;
  locks: Record<Version, string | null>;
  itemLock: string | null;
  /** What each actor read, by version; `before` is a read made before its lock. */
  read: Record<string, Partial<Record<Version | "before", Status>>>;
  pending: Record<
    string,
    { status: Partial<Record<Version, Status>>; writes: Version[] }
  >;
  misplacedWrite: string | null;
};

/** Each switch is one fix; the test replays the bug each one closed. */
export type Protocol = {
  /** d8e790657d: the import reads a version's status on the locked row. */
  importReadsStatusUnderLock: boolean;
  /** 3a9da8dfd0: activation locks the item's versions in id order and reads their statuses there. */
  activationLocksVersions: boolean;
  /** 0f8e87b30b: the sync locks the versions in id order and refuses a version no longer a Draft. */
  syncReadsStatusUnderLock: boolean;
  /** 9e77d7a7c3: a new version sets its source Active only while, under the lock, no other version is. */
  newVersionChecksActive: boolean;
  /** 23f2206ff3: the import locks all of the part's versions in id order before it writes any. */
  importLocksAllVersions: boolean;
};

export const SHIPPED: Protocol = {
  importReadsStatusUnderLock: true,
  activationLocksVersions: true,
  syncReadsStatusUnderLock: true,
  newVersionChecksActive: true,
  importLocksAllVersions: true
};

export const invariants: Model<State>["invariants"] = {
  "at most one version is Active": (s) =>
    VERSIONS.filter((v) => s.status[v] === "Active").length <= 1,
  "a BOM write commits only into a Draft": (s) => s.misplacedWrite === null
};

export function initialState(status: Record<Version, Status>): State {
  return {
    status,
    locks: { v1: null, v2: null, v3: null },
    itemLock: null,
    read: {},
    pending: {},
    misplacedWrite: null
  };
}

function mine(s: State, actor: string) {
  return s.pending[actor] ?? { status: {}, writes: [] };
}

function remember(
  s: State,
  actor: string,
  key: Version | "before",
  status: Status
): State {
  return {
    ...s,
    read: { ...s.read, [actor]: { ...s.read[actor], [key]: status } }
  };
}

function lockRow(s: State, actor: string, v: Version): State | typeof BLOCKED {
  const holder = s.locks[v];
  if (holder !== null && holder !== actor) return BLOCKED;
  return { ...s, locks: { ...s.locks, [v]: actor } };
}

function release(s: State, actor: string): State {
  const { [actor]: _p, ...pending } = s.pending;
  const { [actor]: _r, ...read } = s.read;
  const locks = { ...s.locks };
  for (const v of VERSIONS) if (locks[v] === actor) locks[v] = null;
  return {
    ...s,
    locks,
    itemLock: s.itemLock === actor ? null : s.itemLock,
    pending,
    read
  };
}

/** The actor's refusal: its transaction rolls back. */
function refuse(s: State, actor: string) {
  return halt(release(s, actor));
}

function setPending(
  s: State,
  actor: string,
  change: { status?: Partial<Record<Version, Status>>; write?: Version }
): State {
  const current = mine(s, actor);
  return {
    ...s,
    pending: {
      ...s.pending,
      [actor]: {
        status: { ...current.status, ...change.status },
        writes: change.write
          ? [...current.writes, change.write]
          : current.writes
      }
    }
  };
}

function commit(actor: string): Step<State> {
  return {
    label: "commit",
    run: (s) => {
      const { status, writes } = mine(s, actor);
      let misplacedWrite = s.misplacedWrite;
      for (const v of writes) {
        if (s.status[v] !== "Draft") {
          misplacedWrite ??= `${actor} wrote into ${v} while it was ${s.status[v]}`;
        }
      }
      return {
        ...release(s, actor),
        status: { ...s.status, ...status },
        misplacedWrite
      };
    }
  };
}

/** One SELECT … ORDER BY id FOR NO KEY UPDATE: it takes the rows one at a time. */
function lockEveryVersion(actor: string): Step<State>[] {
  return VERSIONS.map((v) => ({
    label: `lock every version in id order: ${v}`,
    run: (s) => {
      const locked = lockRow(s, actor, v);
      if (locked === BLOCKED) return BLOCKED;
      return remember(locked, actor, v, locked.status[v]);
    }
  }));
}

function readEveryVersion(actor: string, label: string): Step<State> {
  return {
    label,
    run: (s) =>
      VERSIONS.reduce((next, v) => remember(next, actor, v, s.status[v]), s)
  };
}

export function activate(
  protocol: Protocol,
  target: Version,
  name: string
): Actor<State> {
  const steps: Step<State>[] = [];
  const others = VERSIONS.filter((v) => v !== target);
  if (protocol.activationLocksVersions) {
    steps.push(...lockEveryVersion(name), {
      label: "archive the other versions still Active",
      run: (s) =>
        setPending(s, name, {
          status: Object.fromEntries(
            others
              .filter((v) => s.read[name]?.[v] === "Active")
              .map((v) => [v, "Archived" as const])
          )
        })
    });
  } else {
    steps.push(readEveryVersion(name, "read the item's versions"));
    // The UPDATE takes the rows it archives one at a time, with no status guard.
    for (const v of others) {
      steps.push({
        label: `archive the versions it read as Active: ${v}`,
        run: (s) => {
          if (s.read[name]?.[v] !== "Active") return s;
          const locked = lockRow(s, name, v);
          if (locked === BLOCKED) return BLOCKED;
          return setPending(locked, name, { status: { [v]: "Archived" } });
        }
      });
    }
  }
  steps.push(
    {
      label: "set the version Active",
      run: (s) => {
        const locked = lockRow(s, name, target);
        if (locked === BLOCKED) return BLOCKED;
        return setPending(locked, name, { status: { [target]: "Active" } });
      }
    },
    commit(name)
  );
  return { name, steps };
}

/** `targets` in file order. */
export function importInto(
  protocol: Protocol,
  targets: Version[],
  name: string
): Actor<State> {
  const steps: Step<State>[] = [
    {
      label: "lock the item FOR NO KEY UPDATE",
      run: (s) =>
        s.itemLock !== null && s.itemLock !== name
          ? BLOCKED
          : { ...s, itemLock: name }
    }
  ];
  if (protocol.importLocksAllVersions) {
    steps.push(...lockEveryVersion(name));
  } else {
    steps.push(readEveryVersion(name, "read the part's versions"));
  }
  for (const t of targets) {
    if (protocol.importReadsStatusUnderLock) {
      steps.push({
        label: `lock ${t} FOR NO KEY UPDATE, refuse unless it is a Draft`,
        run: (s) => {
          const locked = lockRow(s, name, t);
          if (locked === BLOCKED) return BLOCKED;
          return locked.status[t] === "Draft" ? locked : refuse(locked, name);
        }
      });
    } else {
      steps.push(
        {
          label: `refuse ${t} unless the versions it read say Draft`,
          run: (s) => (s.read[name]?.[t] === "Draft" ? s : refuse(s, name))
        },
        {
          label: `lock ${t} FOR NO KEY UPDATE`,
          run: (s) => lockRow(s, name, t)
        }
      );
    }
    steps.push({
      label: `write ${t}'s BOM lines`,
      run: (s) => setPending(s, name, { write: t })
    });
  }
  steps.push(commit(name));
  return { name, steps };
}

export function sync(
  protocol: Protocol,
  target: Version,
  name: string
): Actor<State> {
  const steps: Step<State>[] = [
    {
      label: "read the make method's status",
      // An Active one is synced into a new Draft and an Archived one refused:
      // neither writes into this version.
      run: (s) =>
        s.status[target] === "Draft"
          ? remember(s, name, "before", s.status[target])
          : halt(s)
    }
  ];
  if (protocol.syncReadsStatusUnderLock) {
    steps.push(...lockEveryVersion(name));
  }
  steps.push(
    {
      label: "delete and insert the version's BOM lines",
      run: (s) =>
        protocol.syncReadsStatusUnderLock && s.read[name]?.[target] !== "Draft"
          ? refuse(s, name)
          : setPending(s, name, { write: target })
    },
    commit(name)
  );
  return { name, steps };
}

export function newVersion(
  protocol: Protocol,
  source: Version,
  name: string
): Actor<State> {
  const steps: Step<State>[] = [
    {
      label: "read the source's status",
      run: (s) => remember(s, name, "before", s.status[source])
    }
  ];
  if (protocol.newVersionChecksActive) {
    steps.push(...lockEveryVersion(name));
  }
  steps.push(
    {
      label: "set the source Active WHERE status = 'Draft'",
      run: (s) => {
        const read = s.read[name] ?? {};
        if (read.before !== "Draft") return s;
        if (
          protocol.newVersionChecksActive &&
          VERSIONS.some((v) => v !== source && read[v] === "Active")
        ) {
          return s;
        }
        const locked = lockRow(s, name, source);
        if (locked === BLOCKED) return BLOCKED;
        return locked.status[source] === "Draft"
          ? setPending(locked, name, { status: { [source]: "Active" } })
          : locked;
      }
    },
    commit(name)
  );
  return { name, steps };
}

export type Operation =
  | { kind: "activate"; version: Version }
  | { kind: "import"; versions: Version[] }
  | { kind: "sync"; version: Version }
  | { kind: "newVersion"; version: Version };

export function operationName(op: Operation) {
  return op.kind === "import"
    ? `import(${op.versions.join(",")})`
    : `${op.kind}(${op.version})`;
}

export function makeMethodVersionsModel(
  start: Record<Version, Status>,
  operations: Operation[],
  protocol: Protocol = SHIPPED
): Model<State> {
  return {
    init: initialState(start),
    actors: operations.map((op, k) => {
      const name = `${operationName(op)}#${k + 1}`;
      if (op.kind === "activate") return activate(protocol, op.version, name);
      if (op.kind === "import") return importInto(protocol, op.versions, name);
      if (op.kind === "sync") return sync(protocol, op.version, name);
      return newVersion(protocol, op.version, name);
    }),
    invariants
  };
}
