import type { Tier } from "../types";

export interface CutoverStep {
  key: string;
  label: string;
}

// Cutover-day checklist, run in order. Each is checkable (kind "check").
export const CUTOVER_STEPS: CutoverStep[] = [
  { key: "freeze", label: "Freeze the old system, no new transactions" },
  {
    key: "load-open",
    label: "Load open transactions (orders, POs, inventory, balances)"
  },
  {
    key: "verify-balances",
    label: "Verify inventory and financial balances tie out"
  },
  { key: "smoke-test", label: "Smoke-test the core daily flows end to end" },
  { key: "switch-users", label: "Switch users over and confirm access" },
  { key: "go-decision", label: "Make the final go / no-go call" }
];

export const HYPERCARE: string[] = [
  "Hands-on, fast-response support for the first 3–4 weeks",
  "Daily check-ins while your team finds its feet on the live system",
  "We triage and fix issues fast while your team settles in",
  "Done when day-to-day runs without us in the room"
];

export interface SupportChannel {
  key: string; // stable key for the per-company detail override
  channel: string;
  detail: string; // default; overridable per company via `golive.support.<key>`
  // Tiers this channel applies to. Omitted => all tiers. The shared hypercare
  // channel is paid-only — self-serve has no Carbon team behind it.
  tiers?: Tier[];
}

export const SUPPORT_CHANNELS: SupportChannel[] = [
  {
    key: "shared",
    channel: "Shared channel",
    detail: "Real-time questions during hypercare",
    tiers: ["guided", "enterprise"]
  },
  {
    key: "docs",
    channel: "Docs & videos",
    detail: "Self-serve reference at docs.carbon.ms"
  },
  { key: "support", channel: "Product support", detail: "Bugs and changes" }
];

// Default hypercare window copy; overridable per company via `golive.hypercareWeeks`.
export const HYPERCARE_WEEKS_DEFAULT = "the first 3 to 4 weeks";
