// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, BLOCKED, halt, type Model, type Step } from "./explore";

/**
 * Issuing one untracked job material for one unit, as four writers run it:
 * the operation completion's issue (`issueJobOperationMaterials`,
 * `apps/erp/app/modules/inventory/inventory.service.ts`), a manual step issue
 * (`partToOperation`, same file), the MES step backflush
 * (`backflushUntrackedMaterialsOnStepRecord`, `apps/mes/app/services/operations.service.ts`,
 * which posts a `partToOperation`) and the job's backflush
 * (`backflush_job_materials`, SQL). The unit needs `NEED`; the job's estimate
 * allows more, which is why a stale read is not capped by it. A manual step
 * issue is an operator's request and is never refused, so only the automatic
 * issues are held to the need.
 *
 * A FIFO / LIFO material also relieves its cost layer: every TypeScript
 * consumer through `calculateCOGS` (`apps/erp/app/modules/shared/shared.service.ts`),
 * which another document (`consume`, a shipment or an adjustment) calls too,
 * and the SQL backflush through its own loop. The open layers are one lock.
 */

const NEED = 1;
const ESTIMATE = 2;
const PER_UNIT = 1;
const LAYER = 1;

type Pending = {
  ledger?: number;
  quantityIssued?: number;
  automatic?: boolean;
  layer?: number;
  relieved?: number;
};

export type State = {
  quantityIssued: number;
  ledger: number;
  /** The cost layer's remainingQuantity. */
  layer: number;
  /** Units the layer's cost was relieved for. */
  relieved: number;
  operationLock: string | null;
  drawLock: string | null;
  strictLock: string | null;
  materialLock: string | null;
  layerLock: string | null;
  read: Record<string, number>;
  pending: Record<string, Pending>;
  overIssue: string | null;
};

type Lock =
  | "operationLock"
  | "drawLock"
  | "strictLock"
  | "materialLock"
  | "layerLock";

/** Each switch is one fix; the test replays the bug each one closed. */
export type Protocol = {
  /** ca513209d8: a completion locks its operation before it reads quantityIssued. */
  lockOperation: boolean;
  /** 5e8ea1f3d2: a completion issues the units' need less what is issued, and a step issue takes the operation lock too. */
  issueByUnitsAccounted: boolean;
  /** f92d1b24fa: a completion takes the draw locks the backflush reads under, then reads quantityIssued again. */
  readUnderDrawLock: boolean;
  /** 5a8961ba33: the job's backflush takes the draw locks under strict backflush too, before the strict locks. */
  backflushDrawLockInStrict: boolean;
  /** c85f0d23cf: the job's backflush locks the open cost layers, in calculateCOGS's order, before it reads them. */
  backflushLocksLayers: boolean;
  /** 5b80420a22: a step backflush sends its target, and the step issue takes only what still reaches it under the material's lock. */
  stepBackflushCapsAtTarget: boolean;
};

export const SHIPPED: Protocol = {
  lockOperation: true,
  issueByUnitsAccounted: true,
  readUnderDrawLock: true,
  backflushDrawLockInStrict: true,
  backflushLocksLayers: true,
  stepBackflushCapsAtTarget: true
};

/** The company's settings (`companySettings`) and the material's costing method. */
export type Settings = {
  /** requireBackflushStorageUnit, at a pull-from location. */
  strict: boolean;
  /** preventNegativeBackflush: only then do the strict bin locks run. */
  preventNegative: boolean;
  /** FIFO or LIFO: the issue relieves a cost layer. */
  layers: boolean;
};

export const STANDARD: Settings = {
  strict: false,
  preventNegative: true,
  layers: false
};

export const invariants: Model<State>["invariants"] = {
  "quantityIssued counts every unit that left the bin": (s) =>
    s.quantityIssued === s.ledger,
  "an automatic issue never takes more than the unit still needs": (s) =>
    s.overIssue === null,
  "a cost layer's remaining quantity never goes below zero": (s) =>
    s.layer >= 0,
  "a cost layer is relieved at most its quantity": (s) => s.relieved <= LAYER
};

export function initialState(): State {
  return {
    quantityIssued: 0,
    ledger: 0,
    layer: LAYER,
    relieved: 0,
    operationLock: null,
    drawLock: null,
    strictLock: null,
    materialLock: null,
    layerLock: null,
    read: {},
    pending: {},
    overIssue: null
  };
}

function take(lock: Lock, actor: string): (s: State) => State | typeof BLOCKED {
  return (s) =>
    s[lock] === null || s[lock] === actor ? { ...s, [lock]: actor } : BLOCKED;
}

function pend(s: State, actor: string, write: Pending): State {
  return {
    ...s,
    pending: { ...s.pending, [actor]: { ...s.pending[actor], ...write } }
  };
}

function commit(actor: string): Step<State> {
  return {
    label: "commit",
    run: (s) => {
      const mine = s.pending[actor];
      const { [actor]: _p, ...pending } = s.pending;
      const free = (holder: string | null) =>
        holder === actor ? null : holder;
      const drawn = mine?.ledger ?? 0;
      let overIssue = s.overIssue;
      if (mine?.automatic && drawn > Math.max(0, NEED - s.ledger)) {
        overIssue ??= `${actor} issued ${drawn} after ${s.ledger} had left`;
      }
      return {
        ...s,
        quantityIssued: mine?.quantityIssued ?? s.quantityIssued,
        ledger: s.ledger + drawn,
        layer: mine?.layer ?? s.layer,
        relieved: s.relieved + (mine?.relieved ?? 0),
        operationLock: free(s.operationLock),
        drawLock: free(s.drawLock),
        strictLock: free(s.strictLock),
        materialLock: free(s.materialLock),
        layerLock: free(s.layerLock),
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
      return pend(locked, actor, { ...amount(locked), automatic });
    }
  };
}

function drawn(s: State, actor: string) {
  return s.pending[actor]?.ledger ?? 0;
}

/**
 * `calculateCOGS` for the rows the actor drew: it locks the open layers FOR
 * UPDATE, reads them, and writes what it read less the relief. Nothing drawn,
 * no ledger row, no call.
 */
function relieveInTypeScript(
  actor: string,
  want: (s: State) => number
): Step<State>[] {
  return [
    {
      label: "calculateCOGS: lock the open layers FOR UPDATE, read them",
      run: (s) => {
        if (want(s) <= 0) return s;
        const locked = take("layerLock", actor)(s);
        if (locked === BLOCKED) return BLOCKED;
        return {
          ...locked,
          read: { ...locked.read, [`${actor}:layer`]: locked.layer }
        };
      }
    },
    {
      label:
        "calculateCOGS: set remainingQuantity to what it read less the relief",
      run: (s) => {
        if (want(s) <= 0) return s;
        const read = s.read[`${actor}:layer`] ?? 0;
        const relief = Math.min(want(s), read);
        return pend(s, actor, { layer: read - relief, relieved: relief });
      }
    }
  ];
}

export function complete(
  protocol: Protocol,
  settings: Settings = STANDARD,
  name = "Complete"
): Actor<State> {
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
  if (settings.strict && settings.preventNegative) {
    steps.push({ label: "lockStrictBins", run: take("strictLock", name) });
  }
  if (!settings.strict) {
    steps.push({
      label: "lock the untracked draws",
      run: take("drawLock", name)
    });
  }
  steps.push(
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
    )
  );
  if (settings.layers) {
    steps.push(...relieveInTypeScript(name, (s) => drawn(s, name)));
  }
  steps.push(commit(name));
  return { name, steps };
}

/**
 * `partToOperation` with a consuming quantity. A step backflush planned
 * `quantity` from an unlocked read; with `target` it takes only what still
 * reaches the target under the material's lock.
 */
function partToOperation(
  protocol: Protocol,
  settings: Settings,
  name: string,
  quantity: (s: State) => number,
  target: ((s: State) => number) | null,
  automatic: boolean
): Step<State>[] {
  const steps: Step<State>[] = [];
  if (protocol.issueByUnitsAccounted) {
    steps.push({
      label: "lock the operation FOR UPDATE",
      run: take("operationLock", name)
    });
  }
  steps.push(
    { label: "lock the untracked draws", run: take("drawLock", name) },
    {
      label: "lock the job material FOR UPDATE, read quantityIssued",
      run: (s) => {
        const locked = take("materialLock", name)(s);
        if (locked === BLOCKED) return BLOCKED;
        return {
          ...locked,
          read: { ...locked.read, [name]: locked.quantityIssued }
        };
      }
    }
  );
  if (settings.strict && settings.preventNegative) {
    steps.push({
      label: "assertBinCovers: lockStrictBins",
      run: take("strictLock", name)
    });
  }
  steps.push(
    write(
      name,
      "draw the quantity, add it to quantityIssued",
      (s) => {
        const read = s.read[name] ?? 0;
        const draw = target
          ? Math.min(quantity(s), Math.max(0, target(s) - read))
          : quantity(s);
        return { ledger: draw, quantityIssued: read + draw };
      },
      automatic
    )
  );
  if (settings.layers) {
    steps.push(...relieveInTypeScript(name, (s) => drawn(s, name)));
  }
  steps.push(commit(name));
  return steps;
}

export function stepIssue(
  protocol: Protocol,
  settings: Settings = STANDARD,
  name = "StepIssue"
): Actor<State> {
  return {
    name,
    steps: partToOperation(
      protocol,
      settings,
      name,
      () => PER_UNIT,
      null,
      false
    )
  };
}

/** The MES step backflush of the unit: it plans in one request and posts in another. */
export function stepBackflush(
  protocol: Protocol,
  settings: Settings = STANDARD,
  name = "StepBackflush"
): Actor<State> {
  const planned = `${name}:planned`;
  const shortfall = (s: State) => NEED * PER_UNIT - (s.read[planned] ?? 0);
  return {
    name,
    steps: [
      {
        label: "read quantityIssued with no lock, plan the unit's shortfall",
        run: (s) => {
          const read = {
            ...s,
            read: { ...s.read, [planned]: s.quantityIssued }
          };
          return shortfall(read) <= 0 ? halt(read) : read;
        }
      },
      ...partToOperation(
        protocol,
        settings,
        name,
        shortfall,
        protocol.stepBackflushCapsAtTarget ? () => NEED * PER_UNIT : null,
        true
      )
    ]
  };
}

export function backflush(
  protocol: Protocol = SHIPPED,
  settings: Settings = STANDARD,
  name = "Backflush"
): Actor<State> {
  const steps: Step<State>[] = [];
  if (!settings.strict || protocol.backflushDrawLockInStrict) {
    steps.push({
      label: "lock the untracked draws",
      run: take("drawLock", name)
    });
  }
  if (settings.strict && settings.preventNegative) {
    steps.push({
      label: "lock the strict bins",
      run: take("strictLock", name)
    });
  }
  steps.push(
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
    )
  );
  if (settings.layers) {
    const layerRead = `${name}:layer`;
    if (protocol.backflushLocksLayers) {
      steps.push({
        label: "lock the open layers FOR UPDATE in calculateCOGS's order",
        run: (s) => (drawn(s, name) > 0 ? take("layerLock", name)(s) : s)
      });
    }
    steps.push(
      {
        label: "read the open layers",
        run: (s) => ({ ...s, read: { ...s.read, [layerRead]: s.layer } })
      },
      {
        label:
          "take the draw from what it read, decrement remainingQuantity by it",
        run: (s) => {
          if (drawn(s, name) <= 0) return s;
          const locked = take("layerLock", name)(s);
          if (locked === BLOCKED) return BLOCKED;
          const relief = Math.min(drawn(s, name), s.read[layerRead] ?? 0);
          return pend(locked, name, {
            layer: locked.layer - relief,
            relieved: relief
          });
        }
      }
    );
  }
  steps.push(commit(name));
  return { name, steps };
}

/** Another document relieving the same item's layer: a shipment, an adjustment. */
export function consume(name = "Consume"): Actor<State> {
  return {
    name,
    steps: [...relieveInTypeScript(name, () => 1), commit(name)]
  };
}

export type Operation =
  | "complete"
  | "stepIssue"
  | "stepBackflush"
  | "backflush"
  | "consume";

const ACTOR_NAMES: Record<Operation, string> = {
  complete: "Complete",
  stepIssue: "StepIssue",
  stepBackflush: "StepBackflush",
  backflush: "Backflush",
  consume: "Consume"
};

export function jobMaterialIssueModel(
  actors: Operation[],
  protocol: Protocol = SHIPPED,
  settings: Settings = STANDARD
): Model<State> {
  return {
    init: initialState(),
    actors: actors.map((op, k) => {
      const name = `${ACTOR_NAMES[op]}#${k + 1}`;
      if (op === "complete") return complete(protocol, settings, name);
      if (op === "stepIssue") return stepIssue(protocol, settings, name);
      if (op === "stepBackflush")
        return stepBackflush(protocol, settings, name);
      if (op === "consume") return consume(name);
      return backflush(protocol, settings, name);
    }),
    invariants
  };
}
