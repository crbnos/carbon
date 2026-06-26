import type { Mod, Tier } from "../types";

export interface ScopeItem {
  label: string;
  moduleTags?: Mod[];
  // Tiers this line applies to. Omitted => all tiers. Self-serve has no Carbon-run
  // migration or formal acceptance, so those lines are paid-only.
  tiers?: Tier[];
}

// In-scope capabilities. Module-tagged rows drop out (and surface under
// "out of scope") when their modules are excluded in Setup & Controls.
export const SCOPE_IN: ScopeItem[] = [
  { label: "Accounting: GL, AR, AP, and month-end close", moduleTags: ["acc"] },
  {
    label: "Inventory and purchasing, with automated planning",
    moduleTags: ["inv", "pur"]
  },
  { label: "Sales, quoting, and configure-to-order", moduleTags: ["sal"] },
  {
    label:
      "Items: item master, BOMs, Bill of Process, engineering changes, CAD",
    moduleTags: ["itm"]
  },
  { label: "Production: shop-floor app and scheduling", moduleTags: ["prd"] },
  { label: "Quality: inspections, nonconformance, CAPA", moduleTags: ["qms"] },
  {
    label: "Data migration of the items on the Data Migration Map",
    tiers: ["guided", "enterprise"]
  },
  {
    label: "Loading your own data with Carbon's import tools",
    tiers: ["self_serve"]
  },
  { label: "Training your team via the Academy and in-app guides" },
  {
    label: "Go-live and acceptance sign-off",
    tiers: ["guided", "enterprise"]
  },
  { label: "Going live on Carbon", tiers: ["self_serve"] }
];

export const SCOPE_OUT: string[] = [
  "Anything not explicitly listed in scope above",
  "Custom development beyond what's listed",
  "Integrations not named here",
  "Historical data older than what's on the Data Migration Map"
];

const SCOPE_OUT_SELF_SERVE: string[] = [
  "Anything not explicitly listed in scope above",
  "Custom development, integrations, or self-hosting",
  "A Carbon-run data migration — you load your own data",
  "A formal acceptance / sign-off phase"
];

export function scopeOutForTier(tier: Tier): string[] {
  return tier === "self_serve" ? SCOPE_OUT_SELF_SERVE : SCOPE_OUT;
}

export const SCOPE_ASSUMPTIONS: string[] = [
  "You name a project owner with decision authority",
  "Champion users are available for training and data validation",
  "Your source data is accessible and reasonably clean",
  "Go-live timing holds if each gate is cleared on schedule"
];

const SCOPE_ASSUMPTIONS_SELF_SERVE: string[] = [
  "You're setting Carbon up yourself, at your own pace",
  "Your team can free up time to learn Carbon and load your data",
  "Your data is accessible and reasonably clean",
  "Standard cloud Carbon fits how your shop runs"
];

export function scopeAssumptionsForTier(tier: Tier): string[] {
  return tier === "self_serve"
    ? SCOPE_ASSUMPTIONS_SELF_SERVE
    : SCOPE_ASSUMPTIONS;
}

// "How we know we're done" copy, by tier. Self-serve has no acceptance/sign-off.
export function scopeDoneForTier(tier: Tier): string {
  return tier === "self_serve"
    ? "Carbon is configured the way your shop runs, your data is loaded, and your team is confident using it. When that's true, you're ready to go live."
    : "The system passes every in-scope acceptance test in your configured system, with your data; the data is validated; and you sign off. Then go-live.";
}

export const SCOPE_GOAL_DEFAULT =
  "Get live on Carbon: one system running quoting, purchasing, the shop floor, inventory, and finance, replacing the current tools.";

// Self-serve page intro — no commercial agreement / legal sign-off, unlike the
// paid lead in PAGE_COPY.scope.
export const SCOPE_LEAD_SELF_SERVE =
  "Read this through — what Carbon will and won't do for your setup. When it looks right, mark it agreed below.";
