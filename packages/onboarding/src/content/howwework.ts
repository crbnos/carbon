import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

export interface CadenceItem {
  key: string; // stable key for the per-company `what` override
  cadence: MessageDescriptor;
  what: MessageDescriptor; // default; overridable per company via `howWeWork.cadence.<key>`
}

export const CADENCE: CadenceItem[] = [
  {
    key: "weekly",
    cadence: msg`Weekly`,
    what: msg`Status call: progress, blockers, what's next`
  },
  {
    key: "as-needed",
    cadence: msg`As needed`,
    what: msg`Working sessions on configuration and data`
  },
  {
    key: "gate",
    cadence: msg`At each gate`,
    what: msg`Sign-off review before moving to the next step`
  }
];

export interface EscalationStep {
  n: number;
  title: MessageDescriptor;
  body: MessageDescriptor;
}

export const ESCALATION: EscalationStep[] = [
  {
    n: 1,
    title: msg`Raise it at the weekly status call`,
    body: msg`Most things get caught and resolved here. Name it plainly.`
  },
  {
    n: 2,
    title: msg`Owner + date on the Project Board`,
    body: msg`If it's blocking or a date is at risk, it gets an owner and is tracked.`
  },
  {
    n: 3,
    title: msg`Escalate to the project leads`,
    body: msg`If it can't wait for the next call, the leads on both sides decide.`
  }
];
