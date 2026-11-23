// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, BLOCKED, type Model, type Step } from "./explore";

/**
 * Issuing one untracked job material for one unit, as three writers run it:
 * the operation completion's issue (`issueJobOperationMaterials`,
 * `apps/erp/app/modules/inventory/inventory.service.ts`), a manual or step
 * issue (`partToOperation`, same file) and the job's backflush
 * (`backflush_job_materials`, SQL). The unit needs `NEED`; the job's estimate
 * allows more, which is why a stale read is not capped by it. The step issue
 * is an operator's request and is never refused, so only the two automatic
 * issues are held to the need.
 */

const NEED = 1;
const ESTIMATE = 2;
const PER_UNIT = 1;

export type State = {
  quantityIssued: number;
  ledger: number;
  operationLock: string | null;
  drawLock: string | null;
  materialLock: string | null;
  read: Record<string, number>;
  pending: Record<
    string,
    { ledger: number; quantityIssued: number; automatic: boolean }
  >;
  overIssue: string | null;
};

/** Each switch is one fix; the test replays the bug each one closed. */
export type Protocol = {
  /** ca513209d8: a completion locks its operation before it reads quantityIssued. */
  lockOperation: boolean;
  /** 5e8ea1f3d2: a completion issues the units' need less what is issued, and a step issue takes the operation lock too. */
  issueByUnitsAccounted: boolean;
  /** A completion takes the draw locks the backflush reads under, then reads quantityIssued again. */
  readUnderDrawLock: boolean;
};

export const SHIPPED: Protocol = {
  lockOperation: true,
  issueByUnitsAccounted: true,
  readUnderDrawLock: true
};

export const invariants: Model<State>["invariants"] = {
  "quantityIssued counts every unit that left the bin": (s) =>
    s.quantityIssued === s.ledger,
  "an automatic issue never takes more than the unit still needs": (s) =>
    s.overIssue === null
};

export function initialState(): State {
  return {
    quantityIssued: 0,
    ledger: 0,
    operationLock: null,
    drawLock: null,
    materialLock: null,
    read: {},
    pending: {},
    overIssue: null
  };
}

function take(
  lock: "operationLock" | "drawLock" | "materialLock",
  actor: string
): (s: State) => State | typeof BLOCKED {
  return (s) =>
    s[lock] === null || s[lock] === actor ? { ...s, [lock]: actor } : BLOCKED;
}

function commit(actor: string): Step<State> {
  return {
    label: "commit",
    run: (s) => {
      const mine = s.pending[actor];
      const { [actor]: _p, ...pending } = s.pending;
      const free = (holder: string | null) =>
        holder === actor ? null : holder;
      let overIssue = s.overIssue;
      if (mine?.automatic && mine.ledger > Math.max(0, NEED - s.ledger)) {
        overIssue ??= `${actor} issued ${mine.ledger} after ${s.ledger} had left`;
      }
      return {
        ...s,
        quantityIssued: mine ? mine.quantityIssued : s.quantityIssued,
        ledger: s.ledger + (mine?.ledger ?? 0),
        operationLock: free(s.operationLock),
        drawLock: free(s.drawLock),
        materialLock: free(s.materialLock),
        pending,
        overIssue
      };
    }
  };
}

/** An UPDATE of the job material row: waits for its lock, then holds it to commit. */
function write(
  actor: string,
  label: string,
  amount: (s: State) => { ledger: number; quantityIssued: number },
  automatic: boolean
): Step<State> {
  return {
    label,
    run: (s) => {
      const locked = take("materialLock", actor)(s);
      if (locked === BLOCKED) return BLOCKED;
      return {
        ...locked,
        pending: {
          ...locked.pending,
          [actor]: { ...amount(locked), automatic }
        }
      };
    }
  };
}

export function complete(protocol: Protocol, name = "Complete"): Actor<State> {
  const steps: Step<State>[] = [];
  if (protocol.lockOperation) {
    steps.push({
      label: "lock the operation FOR UPDATE",
      run: take("operationLock", name)
    });
  }
  steps.push({
    label: "read quantityIssued",
    run: (s) => ({ ...s, read: { ...s.read, [name]: s.quantityIssued } })
  });
  if (protocol.readUnderDrawLock) {
    steps.push({
      label: "lock the untracked draws, read quantityIssued again",
      run: (s) => {
        const locked = take("drawLock", name)(s);
        if (locked === BLOCKED) return BLOCKED;
        return {
          ...locked,
          read: { ...locked.read, [name]: locked.quantityIssued }
        };
      }
    });
  }
  steps.push(
    { label: "lock the untracked draws", run: take("drawLock", name) },
    write(
      name,
      "draw the material, set quantityIssued to what it read plus the draw",
      (s) => {
        const read = s.read[name] ?? 0;
        const draw = protocol.issueByUnitsAccounted
          ? Math.max(0, Math.min(PER_UNIT * NEED, ESTIMATE) - read)
          : Math.max(0, Math.min(PER_UNIT * NEED, ESTIMATE - read));
        return { ledger: draw, quantityIssued: read + draw };
      },
      true
    ),
    commit(name)
  );
  return { name, steps };
}

export function stepIssue(
  protocol: Protocol,
  name = "StepIssue"
): Actor<State> {
  const steps: Step<State>[] = [];
  if (protocol.issueByUnitsAccounted) {
    steps.push({
      label: "lock the operation FOR UPDATE",
      run: take("operationLock", name)
    });
  }
  steps.push(
    { label: "lock the untracked draws", run: take("drawLock", name) },
    write(
      name,
      "lock the job material FOR UPDATE, draw the unit's material, add it to quantityIssued",
      (s) => ({
        ledger: PER_UNIT,
        quantityIssued: s.quantityIssued + PER_UNIT
      }),
      false
    ),
    commit(name)
  );
  return { name, steps };
}

export function backflush(name = "Backflush"): Actor<State> {
  return {
    name,
    steps: [
      { label: "lock the untracked draws", run: take("drawLock", name) },
      {
        label: "read quantityIssued",
        run: (s) => ({ ...s, read: { ...s.read, [name]: s.quantityIssued } })
      },
      write(
        name,
        "draw the target less what it read, add the draw to quantityIssued",
        (s) => {
          const draw = Math.max(0, NEED - (s.read[name] ?? 0));
          return { ledger: draw, quantityIssued: s.quantityIssued + draw };
        },
        true
      ),
      commit(name)
    ]
  };
}

export type Operation = "complete" | "stepIssue" | "backflush";

export function jobMaterialIssueModel(
  actors: Operation[],
  protocol: Protocol = SHIPPED
): Model<State> {
  return {
    init: initialState(),
    actors: actors.map((op, k) => {
      const name = `${op === "complete" ? "Complete" : op === "stepIssue" ? "StepIssue" : "Backflush"}#${k + 1}`;
      if (op === "complete") return complete(protocol, name);
      if (op === "stepIssue") return stepIssue(protocol, name);
      return backflush(name);
    }),
    invariants
  };
}
