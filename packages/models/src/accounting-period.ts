// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, BLOCKED, halt, type Model, type Step } from "./explore";

/**
 * The accounting period lifecycle of `apps/erp/app/modules/accounting/
 * accounting.service.ts`: `lockAccountingPeriod`, `unlockAccountingPeriod`,
 * `closeAccountingPeriod` and `reopenAccountingPeriod`. Each step is one
 * statement or transaction boundary as that code runs it, under READ
 * COMMITTED: a read sees committed rows, an UPDATE waits for the row lock and
 * then re-checks its WHERE against the row it waited for.
 */

export type Status = "Open" | "Locked" | "Closed";

export type Period = { status: Status; snapshot: boolean; closedAt: boolean };

export type State = {
  periods: Period[];
  lifecycleLock: string | null;
  rowLocks: (string | null)[];
  /** Each open transaction's writes, invisible to the others until commit. */
  pending: Record<string, Record<number, Partial<Period>>>;
  illegalTransition: string | null;
};

/** Each switch is one fix; the test replays the bug each one closed. */
export type Protocol = {
  /** 985011ddf6: close and reopen take `lockPeriodLifecycle` and re-check their neighbours under it. */
  lifecycleLock: boolean;
  /** 985011ddf6: reopen is one transaction, not four Supabase calls. */
  reopenInTransaction: boolean;
  /** Lock and unlock update only a row still in the status they read. */
  statusCompareAndSet: boolean;
};

export const SHIPPED: Protocol = {
  lifecycleLock: true,
  reopenInTransaction: true,
  statusCompareAndSet: true
};

const EDGES = new Set([
  "Open>Locked",
  "Locked>Open",
  "Locked>Closed",
  "Closed>Open"
]);

export const invariants: Model<State>["invariants"] = {
  "no period is Closed after one that is not": (s) =>
    s.periods.every(
      (p, i) =>
        p.status !== "Closed" ||
        s.periods.slice(0, i).every((q) => q.status === "Closed")
    ),
  "only a Closed period has a balance snapshot": (s) =>
    s.periods.every((p) => !p.snapshot || p.status === "Closed"),
  "closedAt is set exactly on a Closed period": (s) =>
    s.periods.every((p) => p.closedAt === (p.status === "Closed")),
  "status moves only along Open, Locked, Closed and back": (s) =>
    s.illegalTransition === null
};

export function initialState(statuses: Status[]): State {
  return {
    periods: statuses.map((status) => ({
      status,
      snapshot: status === "Closed",
      closedAt: status === "Closed"
    })),
    lifecycleLock: null,
    rowLocks: statuses.map(() => null),
    pending: {},
    illegalTransition: null
  };
}

function view(s: State, actor: string): Period[] {
  const mine = s.pending[actor] ?? {};
  return s.periods.map((p, i) => ({ ...p, ...mine[i] }));
}

function stage(
  s: State,
  actor: string,
  i: number,
  patch: Partial<Period>
): State {
  const mine = s.pending[actor] ?? {};
  return {
    ...s,
    pending: {
      ...s.pending,
      [actor]: { ...mine, [i]: { ...mine[i], ...patch } }
    }
  };
}

function apply(s: State, writes: Record<number, Partial<Period>>): State {
  let illegalTransition = s.illegalTransition;
  const periods = s.periods.map((p, i) => {
    const next = { ...p, ...writes[i] };
    if (next.status !== p.status && !EDGES.has(`${p.status}>${next.status}`)) {
      illegalTransition ??= `P${i + 1} ${p.status} -> ${next.status}`;
    }
    return next;
  });
  return { ...s, periods, illegalTransition };
}

function release(s: State, actor: string): State {
  const { [actor]: _, ...pending } = s.pending;
  return {
    ...s,
    pending,
    lifecycleLock: s.lifecycleLock === actor ? null : s.lifecycleLock,
    rowLocks: s.rowLocks.map((holder) => (holder === actor ? null : holder))
  };
}

const commit = (s: State, actor: string) =>
  release(apply(s, s.pending[actor] ?? {}), actor);

const rowFree = (s: State, actor: string, i: number) =>
  s.rowLocks[i] === null || s.rowLocks[i] === actor;

function takeLifecycleLock(actor: string): Step<State> {
  return {
    label: "take the company's period lifecycle lock",
    run: (s) =>
      s.lifecycleLock === null || s.lifecycleLock === actor
        ? { ...s, lifecycleLock: actor }
        : BLOCKED
  };
}

/** An autocommit UPDATE: applied at once, not staged in `pending`. */
function updateRow(
  actor: string,
  i: number,
  label: string,
  where: ((p: Period) => boolean) | null,
  patch: Partial<Period>
): Step<State> {
  return {
    label,
    run: (s) => {
      if (!rowFree(s, actor, i)) return BLOCKED;
      const row = s.periods[i];
      if (where && row && !where(row)) return halt(s);
      return apply(s, { [i]: patch });
    }
  };
}

export function lockPeriod(
  i: number,
  protocol: Protocol,
  tag = ""
): Actor<State> {
  const name = `Lock(P${i + 1})${tag}`;
  return {
    name,
    steps: [
      {
        label: "read the period: must be Open",
        run: (s) => (s.periods[i]?.status === "Open" ? s : halt(s))
      },
      updateRow(
        name,
        i,
        "set Locked",
        protocol.statusCompareAndSet ? (p) => p.status === "Open" : null,
        { status: "Locked" }
      )
    ]
  };
}

export function unlockPeriod(
  i: number,
  protocol: Protocol,
  tag = ""
): Actor<State> {
  const name = `Unlock(P${i + 1})${tag}`;
  return {
    name,
    steps: [
      {
        label: "read the period: must be Locked",
        run: (s) => (s.periods[i]?.status === "Locked" ? s : halt(s))
      },
      updateRow(
        name,
        i,
        "set Open",
        protocol.statusCompareAndSet ? (p) => p.status === "Locked" : null,
        { status: "Open" }
      )
    ]
  };
}

export function closePeriod(
  i: number,
  protocol: Protocol,
  tag = ""
): Actor<State> {
  const name = `Close(P${i + 1})${tag}`;
  const earlierOpen = (periods: Period[]) =>
    periods.slice(0, i).some((p) => p.status !== "Closed");
  const steps: Step<State>[] = [
    {
      label: "read the period: must be Locked",
      run: (s) => (s.periods[i]?.status === "Locked" ? s : halt(s))
    },
    {
      label: "count earlier periods not Closed: must be none",
      run: (s) => (earlierOpen(s.periods) ? halt(s) : s)
    }
  ];
  if (protocol.lifecycleLock) steps.push(takeLifecycleLock(name));
  steps.push({
    label: "lock the period FOR NO KEY UPDATE: must be Locked",
    run: (s) => {
      if (!rowFree(s, name, i)) return BLOCKED;
      const locked = {
        ...s,
        rowLocks: s.rowLocks.map((h, j) => (j === i ? name : h))
      };
      return view(locked, name)[i]?.status === "Locked"
        ? locked
        : halt(release(locked, name));
    }
  });
  if (protocol.lifecycleLock) {
    steps.push({
      label: "re-check earlier periods under the lock",
      run: (s) => (earlierOpen(view(s, name)) ? halt(release(s, name)) : s)
    });
  }
  steps.push(
    {
      label: "set Closed and write the balance snapshot",
      run: (s) =>
        stage(s, name, i, { status: "Closed", closedAt: true, snapshot: true })
    },
    { label: "commit", run: (s) => commit(s, name) }
  );
  return { name, steps };
}

export function reopenPeriod(
  i: number,
  protocol: Protocol,
  tag = ""
): Actor<State> {
  const name = `Reopen(P${i + 1})${tag}`;
  const laterClosed = (periods: Period[]) =>
    periods.slice(i + 1).some((p) => p.status === "Closed");
  const dropSnapshots = (periods: Period[]) =>
    Object.fromEntries(
      periods.map((_, j) => [j, { snapshot: false }]).slice(i)
    ) as Record<number, Partial<Period>>;
  const reopened: Partial<Period> = { status: "Open", closedAt: false };

  if (!protocol.reopenInTransaction) {
    return {
      name,
      steps: [
        {
          label: "read the period: must be Closed",
          run: (s) => (s.periods[i]?.status === "Closed" ? s : halt(s))
        },
        {
          label: "count later periods Closed: must be none",
          run: (s) => (laterClosed(s.periods) ? halt(s) : s)
        },
        {
          label: "delete the snapshots from this period on",
          run: (s) => apply(s, dropSnapshots(s.periods))
        },
        updateRow(name, i, "set Open", null, reopened)
      ]
    };
  }

  const steps: Step<State>[] = [];
  if (protocol.lifecycleLock) steps.push(takeLifecycleLock(name));
  steps.push(
    {
      label: "lock the period FOR NO KEY UPDATE: must be Closed",
      run: (s) => {
        if (!rowFree(s, name, i)) return BLOCKED;
        const locked = {
          ...s,
          rowLocks: s.rowLocks.map((h, j) => (j === i ? name : h))
        };
        return view(locked, name)[i]?.status === "Closed"
          ? locked
          : halt(release(locked, name));
      }
    },
    {
      label: "count later periods Closed: must be none",
      run: (s) => (laterClosed(view(s, name)) ? halt(release(s, name)) : s)
    },
    {
      label: "delete the snapshots from this period on, set Open",
      run: (s) => {
        let next = s;
        for (const [j, patch] of Object.entries(dropSnapshots(s.periods))) {
          next = stage(next, name, Number(j), patch);
        }
        return stage(next, name, i, reopened);
      }
    },
    { label: "commit", run: (s) => commit(s, name) }
  );
  return { name, steps };
}

export const operations = {
  lock: lockPeriod,
  unlock: unlockPeriod,
  close: closePeriod,
  reopen: reopenPeriod
};

export type Operation = keyof typeof operations;

export function periodModel(
  statuses: Status[],
  actors: [Operation, number][],
  protocol: Protocol = SHIPPED
): Model<State> {
  return {
    init: initialState(statuses),
    actors: actors.map(([op, i], k) =>
      operations[op](
        i,
        protocol,
        actors.findIndex(([o, j]) => o === op && j === i) === k ? "" : `#${k}`
      )
    ),
    invariants
  };
}
