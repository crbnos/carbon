import type { ShortcutDefinition, ShortcutInput } from "@carbon/react";
import { SHORTCUTS } from "@carbon/react";

/**
 * Single source of truth for every ERP key combo (shared combos come from
 * `SHORTCUTS` in @carbon/react; MES has its own file). Components import
 * named constants — never write a combo string literal at a call site.
 */
export { SHORTCUTS };

/** Global search / go-to palette. */
export const searchShortcut: ShortcutDefinition = {
  key: "K",
  modifiers: ["mod"]
};

/**
 * Detail-page section tabs (⌘⇧<letter>), bound by DetailsTopbar/DetailSidebar
 * link definitions. Planning is N — P was silently double-bound to Purchasing
 * for years (the legacy record-based hook dropped duplicates).
 */
export const DETAIL_TAB_SHORTCUTS = {
  details: "mod+shift+d",
  /** Inventory item pages. */
  activity: "mod+shift+a",
  accounting: "mod+shift+a",
  purchasing: "mod+shift+p",
  planning: "mod+shift+n",
  inventory: "mod+shift+i",
  quality: "mod+shift+q",
  /** Item pages use X — S belongs to Shipping on the supplier/customer sidebars. */
  sales: "mod+shift+x",
  contacts: "mod+shift+c",
  locations: "mod+shift+l",
  payment: "mod+shift+p",
  tax: "mod+shift+t",
  shipping: "mod+shift+s",
  processes: "mod+shift+r"
} as const satisfies Record<string, ShortcutInput>;

/** Document-line explorer actions (Quote, SO, PO, invoices, procedures…). */
export const EXPLORER_SHORTCUTS = {
  addLine: "mod+shift+l",
  addAttribute: "mod+shift+a",
  addParameter: "mod+shift+p"
} as const satisfies Record<string, ShortcutInput>;

/**
 * Onboarding flow. Enter is the continue key — onboarding screens are
 * one-obvious-action (choice screens / simple steps), so the Next button
 * carries this via its `shortcut` prop and shows the ↵ badge.
 */
export const ONBOARDING_SHORTCUTS = {
  continue: "enter"
} as const satisfies Record<string, ShortcutInput>;

/** Table pagination. */
export const PAGINATION_SHORTCUTS = {
  previous: "arrowleft",
  next: "arrowright"
} as const satisfies Record<string, ShortcutInput>;

/**
 * g-then-letter module go-to, keyed by the stable module `key` from
 * useModules() — never by position, since module order and visibility are
 * per-user. `shopFloor` is an external MES link and deliberately absent.
 */
export const MODULE_GO_TO_PREFIX = "g";

export const MODULE_GO_TO: Record<string, string> = {
  accounting: "a",
  documents: "d",
  inventory: "i",
  invoicing: "v",
  parts: "t",
  people: "o",
  production: "r",
  purchasing: "p",
  quality: "q",
  resources: "u",
  sales: "s",
  settings: "e",
  users: "y",
  workflows: "w"
};
