// @carbon/onboarding/engine — the server-safe slice of the hub for
// @carbon/jobs (Inngest crons). STRICTLY MACRO-FREE: nothing in this module's
// import graph may execute a Lingui macro at module scope (jobs builds without
// the macro transform), which is why gate titles here are plain English
// strings — exactly what the English-only transactional emails need.
//
// Client/app code should keep importing "@carbon/onboarding"; this entry
// exists only for node-side consumers.

export * from "./logic/intakeRows";
export * from "./logic/streak";

export interface CheckStateLike {
  itemKey: string;
  value: string;
}

// The seven phases, in journey order, with plain-English titles for emails and
// internal surfaces. Keys mirror content/spine.ts (keys are forever).
export const GATE_SEQUENCE: { key: string; title: string }[] = [
  { key: "gate:intake", title: "Tell Us How You Run" },
  { key: "gate:basics", title: "Set Up the Basics" },
  { key: "gate:load-data", title: "Load Your Data" },
  { key: "gate:pilot", title: "Prove It Works" },
  { key: "gate:crew", title: "Ready Your Team" },
  { key: "gate:switch", title: "Make the Switch" },
  { key: "gate:live", title: "Live on Carbon" }
];

// Manual-gate progress from raw check states (the crons don't run the detect
// probes; a manually-or-programmatically completed gate is what "done" means
// for digests and nudges).
export function gateProgress(states: CheckStateLike[]): {
  done: number;
  total: number;
  next: { key: string; title: string } | null;
} {
  const map = new Map(states.map((s) => [s.itemKey, s.value]));
  let done = 0;
  let next: { key: string; title: string } | null = null;
  for (const gate of GATE_SEQUENCE) {
    if (map.get(gate.key) === "done") {
      done += 1;
    } else if (!next) {
      next = gate;
    }
  }
  return { done, total: GATE_SEQUENCE.length, next };
}

// Milestone check-state guard keys (exactly-once notifications).
export const milestoneGuardKey = (milestone: number) =>
  `check:live.milestone.${milestone}`;

// Which milestones notify beyond the in-app celebration: days 3 and 10 send
// the trophy email (CC the Carbon team) + the internal Slack ping; day 5
// celebrates in-app only (Chase's call).
export const NOTIFYING_MILESTONES = [3, 10] as const;
