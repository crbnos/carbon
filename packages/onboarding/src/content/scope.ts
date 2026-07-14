import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { Mod, Tier } from "../types";

export interface ScopeItem {
  label: MessageDescriptor;
  moduleTags?: Mod[];
  // Tiers this line applies to. Omitted => all tiers. Self-serve has no Carbon-run
  // migration or formal acceptance, so those lines are paid-only.
  tiers?: Tier[];
}

// In-scope capabilities. Module-tagged rows drop out (and surface under
// "out of scope") when their modules are excluded in Setup & Controls.
export const SCOPE_IN: ScopeItem[] = [
  {
    label: msg`Accounting: GL, AR, AP, and month-end close`,
    moduleTags: ["acc"]
  },
  {
    label: msg`Inventory and purchasing, with automated planning`,
    moduleTags: ["inv", "pur"]
  },
  { label: msg`Sales, quoting, and configure-to-order`, moduleTags: ["sal"] },
  {
    label: msg`Items: item master, BOMs, Bill of Process, engineering changes, CAD`,
    moduleTags: ["itm"]
  },
  {
    label: msg`Production: shop-floor app and scheduling`,
    moduleTags: ["prd"]
  },
  {
    label: msg`Quality: inspections, nonconformance, CAPA`,
    moduleTags: ["qms"]
  },
  {
    label: msg`Data migration of the items on the Data Migration Map`,
    tiers: ["guided", "enterprise"]
  },
  {
    label: msg`Loading your own data with Carbon's import tools`,
    tiers: ["self_serve"]
  },
  { label: msg`Training your team via the Academy and in-app guides` },
  {
    label: msg`Go-live and acceptance sign-off`,
    tiers: ["guided", "enterprise"]
  },
  { label: msg`Going live on Carbon`, tiers: ["self_serve"] }
];

export const SCOPE_OUT: MessageDescriptor[] = [
  msg`Anything not explicitly listed in scope above`,
  msg`Custom development beyond what's listed`,
  msg`Integrations not named here`,
  msg`Historical data older than what's on the Data Migration Map`
];

const SCOPE_OUT_SELF_SERVE: MessageDescriptor[] = [
  msg`Anything not explicitly listed in scope above`,
  msg`Custom development, integrations, or self-hosting`,
  msg`A Carbon-run data migration — you load your own data`,
  msg`A formal acceptance / sign-off phase`
];

export function scopeOutForTier(tier: Tier): MessageDescriptor[] {
  return tier === "self_serve" ? SCOPE_OUT_SELF_SERVE : SCOPE_OUT;
}

export const SCOPE_ASSUMPTIONS: MessageDescriptor[] = [
  msg`You name a project owner with decision authority`,
  msg`Champion users are available for training and data validation`,
  msg`Your source data is accessible and reasonably clean`,
  msg`Go-live timing holds if each gate is cleared on schedule`
];

const SCOPE_ASSUMPTIONS_SELF_SERVE: MessageDescriptor[] = [
  msg`You're setting Carbon up yourself, at your own pace`,
  msg`Your team can free up time to learn Carbon and load your data`,
  msg`Your data is accessible and reasonably clean`,
  msg`Standard cloud Carbon fits how your company runs`
];

export function scopeAssumptionsForTier(tier: Tier): MessageDescriptor[] {
  return tier === "self_serve"
    ? SCOPE_ASSUMPTIONS_SELF_SERVE
    : SCOPE_ASSUMPTIONS;
}

// "How we know we're done" copy, by tier. Self-serve has no acceptance/sign-off.
export function scopeDoneForTier(tier: Tier): MessageDescriptor {
  return tier === "self_serve"
    ? msg`Carbon is configured the way your company runs, your data is loaded, and your team is confident using it. When that's true, you're ready to go live.`
    : msg`The system passes every in-scope acceptance test in your configured system, with your data; the data is validated; and you sign off. Then go-live.`;
}

export const SCOPE_GOAL_DEFAULT: MessageDescriptor = msg`Get live on Carbon: one system running quoting, purchasing, the shop floor, inventory, and finance, replacing the current tools.`;

// Self-serve page intro — no commercial agreement / legal sign-off, unlike the
// paid lead in PAGE_COPY.scope.
export const SCOPE_LEAD_SELF_SERVE: MessageDescriptor = msg`Read this through — what Carbon will and won't do for your setup. When it looks right, mark it agreed below.`;
