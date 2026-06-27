import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Tier } from "../types";

export interface CutoverStep {
  key: string;
  label: MessageDescriptor;
}

// Cutover-day checklist, run in order. Each is checkable (kind "check").
export const CUTOVER_STEPS: CutoverStep[] = [
  { key: "freeze", label: msg`Freeze the old system, no new transactions` },
  {
    key: "load-open",
    label: msg`Load open transactions (orders, POs, inventory, balances)`
  },
  {
    key: "verify-balances",
    label: msg`Verify inventory and financial balances tie out`
  },
  { key: "smoke-test", label: msg`Smoke-test the core daily flows end to end` },
  { key: "switch-users", label: msg`Switch users over and confirm access` },
  { key: "go-decision", label: msg`Make the final go / no-go call` }
];

export const HYPERCARE: MessageDescriptor[] = [
  msg`Hands-on, fast-response support for the first 3–4 weeks`,
  msg`Daily check-ins while your team finds its feet on the live system`,
  msg`We triage and fix issues fast while your team settles in`,
  msg`Done when day-to-day runs without us in the room`
];

export interface SupportChannel {
  key: string; // stable key for the per-company detail override
  channel: MessageDescriptor;
  detail: MessageDescriptor; // default; overridable per company via `golive.support.<key>`
  // Tiers this channel applies to. Omitted => all tiers. The shared hypercare
  // channel is paid-only — self-serve has no Carbon team behind it.
  tiers?: Tier[];
}

export const SUPPORT_CHANNELS: SupportChannel[] = [
  {
    key: "shared",
    channel: msg`Shared channel`,
    detail: msg`Real-time questions during hypercare`,
    tiers: ["guided", "enterprise"]
  },
  {
    key: "docs",
    channel: msg`Docs & videos`,
    detail: msg`Self-serve reference at docs.carbon.ms`
  },
  {
    key: "support",
    channel: msg`Product support`,
    detail: msg`Bugs and changes`
  }
];

// Default hypercare window copy; overridable per company via `golive.hypercareWeeks`.
export const HYPERCARE_WEEKS_DEFAULT = msg`the first 3 to 4 weeks`;
