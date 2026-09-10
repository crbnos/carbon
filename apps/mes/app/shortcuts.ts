import type { ShortcutInput } from "@carbon/react";
import { SHORTCUTS } from "@carbon/react";

/**
 * Single source of truth for every MES key combo (shared combos come from
 * `SHORTCUTS` in @carbon/react; the ERP has its own file). Components import
 * named constants — never write a combo string literal at a call site.
 *
 * MES is touch-first with barcode scanners that emit keystrokes, so bare
 * letters are avoided throughout.
 */
export { SHORTCUTS };

/** ⌥+digit — ⌘+digit is browser-reserved tab switching. Order matches AppSidebar. */
export const MES_NAV_SHORTCUTS = {
  operations: "alt+1",
  assigned: "alt+2",
  active: "alt+3",
  recent: "alt+4",
  jobs: "alt+5",
  maintenance: "alt+6",
  picking: "alt+7"
} as const satisfies Record<string, ShortcutInput>;

/** Start/Pause the job operation (the big round button). */
export const START_STOP_SHORTCUT: ShortcutInput = "space";
