// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, BLOCKED, halt, type Model, type Step } from "./explore";

/**
 * Documents posting into one order line's counter (`quantityInvoiced`,
 * `quantityReceived`, `quantitySent`, `quantityShipped`) and its `*Complete`
 * flag, as the posts and voids in `postSalesInvoice` / `postPurchaseInvoice`
 * (`apps/erp/app/modules/invoicing/invoicing.service.ts`) and `postReceipt` /
 * `postShipment` (`apps/erp/app/modules/inventory/inventory.service.ts`) run
 * them. Each writes the line, then sets its order's status from the lines.
 *
 * D1 is posted at the start; D2 and D3 are drafts of the same line. A post
 * whose order lock came first in its transaction before the fix (the purchase
 * invoice post, the return receipt post) is `orderFirst`. A void reads the
 * line before its transaction and refuses when it moved (the invoice,
 * receipt and shipment voids), or reads it under the lock (`underLock`: the
 * return voids, the return ship-back, and the force delete's `restore*`).
 */

const QUANTITY: Record<Document, number> = { D1: 2, D2: 1, D3: 1 };
const ORDERED = 3;

export type Document = "D1" | "D2" | "D3";

export type State = {
  counter: number;
  complete: boolean;
  status: Record<Document, "Draft" | "Posted" | "Voided">;
  orderLock: string | null;
  lineLock: string | null;
  read: Record<string, number>;
  pending: Record<
    string,
    {
      counter: number;
      complete: boolean;
      document: Document;
      to: "Posted" | "Voided";
    }
  >;
};

/** Each switch is one fix; the test replays the bug each one closed. */
export type Protocol = {
  /** 9359b57e9e: a post or void locks the order, then the line, before it writes, and refuses when the line moved since its read. */
  lockLinesAsRead: boolean;
  /** e179b0d865: a writer that reads the line under its lock takes the order lock before the line lock. */
  orderBeforeLine: boolean;
};

export const SHIPPED: Protocol = {
  lockLinesAsRead: true,
  orderBeforeLine: true
};

export const invariants: Model<State>["invariants"] = {
  "the counter is the sum over the posted documents": (s) =>
    s.counter ===
    (Object.keys(QUANTITY) as Document[])
      .filter((d) => s.status[d] === "Posted")
      .reduce((sum, d) => sum + QUANTITY[d], 0),
  "the complete flag is the counter against the ordered quantity": (s) =>
    s.complete === s.counter >= ORDERED
};

export function initialState(): State {
  return {
    counter: QUANTITY.D1,
    complete: QUANTITY.D1 >= ORDERED,
    status: { D1: "Posted", D2: "Draft", D3: "Draft" },
    orderLock: null,
    lineLock: null,
    read: {},
    pending: {}
  };
}

type Lock = "orderLock" | "lineLock";

function take(s: State, lock: Lock, actor: string): State | typeof BLOCKED {
  return s[lock] === null || s[lock] === actor
    ? { ...s, [lock]: actor }
    : BLOCKED;
}

function release(s: State, actor: string): State {
  const { [actor]: _pending, ...pending } = s.pending;
  return {
    ...s,
    orderLock: s.orderLock === actor ? null : s.orderLock,
    lineLock: s.lineLock === actor ? null : s.lineLock,
    pending
  };
}

const readLine = (name: string): Step<State> => ({
  label: "read the order line",
  run: (s) => ({ ...s, read: { ...s.read, [name]: s.counter } })
});

const lockOrder = (name: string): Step<State> => ({
  label: "lock the order FOR UPDATE",
  run: (s) => take(s, "orderLock", name)
});

const lockLineAsRead = (name: string): Step<State> => ({
  label: "lock the line FOR UPDATE, refuse if it moved since the read",
  run: (s) => {
    const locked = take(s, "lineLock", name);
    if (locked === BLOCKED) return BLOCKED;
    return locked.counter === locked.read[name]
      ? locked
      : halt(release(locked, name));
  }
});

const lockLineAndRead = (name: string): Step<State> => ({
  label: "lock the line FOR UPDATE and read it",
  run: (s) => {
    const locked = take(s, "lineLock", name);
    if (locked === BLOCKED) return BLOCKED;
    return { ...locked, read: { ...locked.read, [name]: locked.counter } };
  }
});

/** The line UPDATE: waits for the line's lock, then holds it to commit. */
const writeLine = (
  name: string,
  document: Document,
  to: "Posted" | "Voided"
): Step<State> => ({
  label:
    to === "Posted"
      ? "write the line: what it read plus the document"
      : "write the line: what it read less the document",
  run: (s) => {
    const locked = take(s, "lineLock", name);
    if (locked === BLOCKED) return BLOCKED;
    const read = locked.read[name] ?? 0;
    const counter =
      to === "Posted" ? read + QUANTITY[document] : read - QUANTITY[document];
    return {
      ...locked,
      pending: {
        ...locked.pending,
        [name]: { counter, complete: counter >= ORDERED, document, to }
      }
    };
  }
});

const setOrderStatus = (name: string): Step<State> => ({
  label: "set the order's status from its lines",
  run: (s) => take(s, "orderLock", name)
});

const commit = (name: string): Step<State> => ({
  label: "commit",
  run: (s) => {
    const mine = s.pending[name];
    const released = release(s, name);
    if (!mine) return released;
    return {
      ...released,
      counter: mine.counter,
      complete: mine.complete,
      status: { ...released.status, [mine.document]: mine.to }
    };
  }
});

export type Operation =
  | { op: "post"; document: Document; orderFirst?: boolean }
  | { op: "void"; document: Document; underLock?: boolean };

export function post(
  protocol: Protocol,
  document: Document,
  { orderFirst = false, name = `Post ${document}` } = {}
): Actor<State> {
  const steps: Step<State>[] = [readLine(name)];
  if (protocol.lockLinesAsRead) {
    steps.push(lockOrder(name), lockLineAsRead(name));
  } else if (orderFirst) {
    steps.push(lockOrder(name));
  }
  steps.push(
    writeLine(name, document, "Posted"),
    setOrderStatus(name),
    commit(name)
  );
  return { name, steps };
}

export function voidDocument(
  protocol: Protocol,
  document: Document,
  { underLock = false, name = `Void ${document}` } = {}
): Actor<State> {
  const steps: Step<State>[] = [];
  if (underLock) {
    if (protocol.orderBeforeLine) steps.push(lockOrder(name));
    steps.push(lockLineAndRead(name));
  } else {
    steps.push(readLine(name));
    if (protocol.lockLinesAsRead) {
      steps.push(lockOrder(name), lockLineAsRead(name));
    }
  }
  steps.push(
    writeLine(name, document, "Voided"),
    setOrderStatus(name),
    commit(name)
  );
  return { name, steps };
}

export function orderLineCountersModel(
  operations: Operation[],
  protocol: Protocol = SHIPPED
): Model<State> {
  return {
    init: initialState(),
    actors: operations.map((operation) =>
      operation.op === "post"
        ? post(protocol, operation.document, {
            orderFirst: operation.orderFirst
          })
        : voidDocument(protocol, operation.document, {
            underLock: operation.underLock
          })
    ),
    invariants
  };
}
