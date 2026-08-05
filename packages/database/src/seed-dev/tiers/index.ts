import type { Tier } from "../types.ts";
import { runTier1 } from "./01-foundation.ts";
import { runTier2 } from "./02-items.ts";
import { runTier3 } from "./03-inventory.ts";
import { runTier4 } from "./04-sales.ts";
import { runTier5 } from "./05-purchasing.ts";
import { runTier6 } from "./06-production.ts";
import { runTier7 } from "./07-quality.ts";
import { runTier8 } from "./08-change-orders.ts";
import { runTier9 } from "./09-accounting.ts";
import { runTier10 } from "./10-ops.ts";
import { runTier11 } from "./11-workflows.ts";
import { runTier12 } from "./12-planning.ts";

export const TIERS: Tier[] = [
  { n: 1, name: "Foundation", run: runTier1 },
  { n: 2, name: "Item catalog + BOM/BOP", run: runTier2 },
  { n: 3, name: "Inventory position", run: runTier3 },
  { n: 4, name: "Sales chain", run: runTier4 },
  { n: 5, name: "Purchasing chain", run: runTier5 },
  { n: 6, name: "Production", run: runTier6 },
  { n: 7, name: "Quality", run: runTier7 },
  { n: 8, name: "Change orders", run: runTier8 },
  { n: 9, name: "Accounting + fixed assets", run: runTier9 },
  { n: 10, name: "Ops / misc", run: runTier10 },
  { n: 11, name: "Workflows", run: runTier11 },
  { n: 12, name: "Planning prerequisites", run: runTier12 }
];

export function selectTiers(only: number[] | null): Tier[] {
  if (!only) return TIERS;
  const wanted = new Set(only);
  const picked = TIERS.filter((t) => wanted.has(t.n));
  const missing = only.filter((n) => !TIERS.some((t) => t.n === n));
  if (missing.length > 0) {
    throw new Error(`Seed: no such tier(s): ${missing.join(", ")}`);
  }
  return picked;
}
