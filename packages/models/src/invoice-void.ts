// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { type Actor, BLOCKED, halt, type Model, type Step } from "./explore";

/**
 * Voiding a posted invoice against a line account change, as
 * `postSalesInvoice` / `postPurchaseInvoice` (`type: "void"`) and
 * `changeInvoiceLineAccount` run them
 * (`apps/erp/app/modules/invoicing/invoicing.service.ts`). The journal is the
 * invoice's net amount per account; the line is on `line`, the control
 * account is `control`.
 */

export type Journal = Record<string, number>;

export type State = {
  status: "Posted" | "Voided";
  journal: Journal;
  voidJournals: number;
  invoiceLock: string | null;
  /** The journal a void read, by actor: it reverses exactly that. */
  read: Record<string, Journal>;
  pending: Record<string, { journal: Journal; voided: boolean }>;
};

export type Protocol = {
  /** The purchase void refuses a Voided invoice before its transaction; the sales void never did. */
  refuseVoidedBeforeTransaction: boolean;
  /** 6797ddd57f: the void locks the invoice before it reads the journal. */
  lockBeforeJournalRead: boolean;
  /** The void re-reads the status under the invoice lock and refuses Voided. */
  refuseVoidedUnderLock: boolean;
};

export const SHIPPED_SALES: Protocol = {
  refuseVoidedBeforeTransaction: false,
  lockBeforeJournalRead: true,
  refuseVoidedUnderLock: true
};

export const SHIPPED_PURCHASE: Protocol = {
  ...SHIPPED_SALES,
  refuseVoidedBeforeTransaction: true
};

const ACCOUNTS = ["sales", "other"] as const;

export const invariants: Model<State>["invariants"] = {
  "a voided invoice nets to zero on every account": (s) =>
    s.status !== "Voided" || Object.values(s.journal).every((v) => v === 0),
  "an invoice is reversed at most once": (s) => s.voidJournals <= 1
};

export function initialState(amount = 100): State {
  return {
    status: "Posted",
    journal: { control: amount, sales: -amount, other: 0 },
    voidJournals: 0,
    invoiceLock: null,
    read: {},
    pending: {}
  };
}

function add(a: Journal, b: Journal): Journal {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

const negate = (j: Journal): Journal =>
  Object.fromEntries(Object.entries(j).map(([k, v]) => [k, -v]));

function lockInvoice(actor: string, s: State): State | typeof BLOCKED {
  if (s.invoiceLock !== null && s.invoiceLock !== actor) return BLOCKED;
  return { ...s, invoiceLock: actor };
}

function end(s: State, actor: string): State {
  const { [actor]: _p, ...pending } = s.pending;
  const { [actor]: _r, ...read } = s.read;
  return {
    ...s,
    pending,
    read,
    invoiceLock: s.invoiceLock === actor ? null : s.invoiceLock
  };
}

function commit(s: State, actor: string): State {
  const mine = s.pending[actor];
  if (!mine) return end(s, actor);
  return end(
    {
      ...s,
      journal: add(s.journal, mine.journal),
      status: mine.voided ? "Voided" : s.status,
      voidJournals: s.voidJournals + (mine.voided ? 1 : 0)
    },
    actor
  );
}

export function voidInvoice(protocol: Protocol, name = "Void"): Actor<State> {
  const steps: Step<State>[] = [];
  if (protocol.refuseVoidedBeforeTransaction) {
    steps.push({
      label: "read the invoice: refuse Voided",
      run: (s) => (s.status === "Voided" ? halt(s) : s)
    });
  }
  const readJournal: Step<State> = {
    label: "read the invoice's journal lines",
    run: (s) => ({ ...s, read: { ...s.read, [name]: s.journal } })
  };
  if (!protocol.lockBeforeJournalRead) steps.push(readJournal);
  steps.push({
    label: "lock the invoice FOR UPDATE",
    run: (s) => {
      const locked = lockInvoice(name, s);
      if (locked === BLOCKED) return BLOCKED;
      return protocol.refuseVoidedUnderLock && locked.status === "Voided"
        ? halt(end(locked, name))
        : locked;
    }
  });
  if (protocol.lockBeforeJournalRead) steps.push(readJournal);
  steps.push(
    {
      label: "insert the reversal and set Voided",
      run: (s) => ({
        ...s,
        pending: {
          ...s.pending,
          [name]: { journal: negate(s.read[name] ?? {}), voided: true }
        }
      })
    },
    { label: "commit", run: (s) => commit(s, name) }
  );
  return { name, steps };
}

/** Moves the line to the account it is not on. */
export function changeLineAccount(name = "Change"): Actor<State> {
  return {
    name,
    steps: [
      {
        label: "lock the invoice FOR UPDATE: refuse Voided",
        run: (s) => {
          const locked = lockInvoice(name, s);
          if (locked === BLOCKED) return BLOCKED;
          return locked.status === "Voided" ? halt(end(locked, name)) : locked;
        }
      },
      {
        label: "insert the change journal",
        run: (s) => {
          const from = ACCOUNTS.find((a) => (s.journal[a] ?? 0) !== 0);
          const to = ACCOUNTS.find((a) => a !== from);
          if (!from || !to) return halt(end(s, name));
          const amount = s.journal[from] ?? 0;
          return {
            ...s,
            pending: {
              ...s.pending,
              [name]: {
                journal: { [from]: -amount, [to]: amount },
                voided: false
              }
            }
          };
        }
      },
      { label: "commit", run: (s) => commit(s, name) }
    ]
  };
}

export type Operation = "void" | "change";

export function invoiceVoidModel(
  actors: Operation[],
  protocol: Protocol
): Model<State> {
  return {
    init: initialState(),
    actors: actors.map((op, k) => {
      const name = `${op === "void" ? "Void" : "Change"}#${k + 1}`;
      return op === "void"
        ? voidInvoice(protocol, name)
        : changeLineAccount(name);
    }),
    invariants
  };
}
