export interface CadenceItem {
  key: string; // stable key for the per-company `what` override
  cadence: string;
  what: string; // default; overridable per company via `howWeWork.cadence.<key>`
}

export const CADENCE: CadenceItem[] = [
  {
    key: "weekly",
    cadence: "Weekly",
    what: "Status call: progress, blockers, what's next"
  },
  {
    key: "as-needed",
    cadence: "As needed",
    what: "Working sessions on configuration and data"
  },
  {
    key: "gate",
    cadence: "At each gate",
    what: "Sign-off review before moving to the next step"
  }
];

export interface EscalationStep {
  n: number;
  title: string;
  body: string;
}

export const ESCALATION: EscalationStep[] = [
  {
    n: 1,
    title: "Raise it at the weekly status call",
    body: "Most things get caught and resolved here. Name it plainly."
  },
  {
    n: 2,
    title: "Owner + date on the Project Board",
    body: "If it's blocking or a date is at risk, it gets an owner and is tracked."
  },
  {
    n: 3,
    title: "Escalate to the project leads",
    body: "If it can't wait for the next call, the leads on both sides decide."
  }
];
