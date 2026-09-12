import { GAP_CATALOG } from "./catalog.ts";
import type { GapArea, MigrationGapDefinition } from "./types.ts";

/**
 * `GAPS.md` is generated from `GAP_CATALOG` rather than written by hand, and
 * `catalog.test.ts` fails when the file on disk no longer matches. A gap
 * register that drifts from the code is worse than none: it is a promise the
 * product stopped keeping without telling anyone.
 */

const AREA_TITLES: Record<GapArea, string> = {
  accounting: "Accounting",
  customers: "Customers",
  suppliers: "Suppliers",
  items: "Items",
  manufacturing: "Manufacturing",
  inventory: "Inventory",
  sales: "Sales",
  purchasing: "Purchasing",
  platform: "Platform"
};

const AREA_ORDER: GapArea[] = [
  "platform",
  "accounting",
  "customers",
  "suppliers",
  "items",
  "manufacturing",
  "inventory",
  "sales",
  "purchasing"
];

const STATUS_LABELS = {
  "not-migrated": "Not migrated",
  partial: "Partial",
  transformed: "Transformed"
} as const;

function renderGap(gap: MigrationGapDefinition): string {
  return [
    `#### ${gap.id} — ${gap.title}`,
    "",
    `**Severity:** ${gap.severity} · **Status:** ${STATUS_LABELS[gap.status]}`,
    "",
    gap.detail,
    "",
    `*What to do instead:* ${gap.workaround}`,
    ""
  ].join("\n");
}

export function renderGapsMarkdown(): string {
  const bySeverity = (severity: string) =>
    GAP_CATALOG.filter((gap) => gap.severity === severity).length;

  const lines: string[] = [
    "<!-- Generated from src/gaps/catalog.ts by `pnpm --filter @carbon/netsuite generate:gaps`. Do not edit by hand. -->",
    "",
    "# What a NetSuite migration leaves behind",
    "",
    "Carbon's one-click NetSuite migration brings across the records a manufacturer",
    "needs to operate on day one: the chart of accounts, customers, suppliers, items,",
    "bills of material, on-hand stock, and open sales and purchase orders.",
    "",
    "This file is the complete list of what it does **not** bring, and what to do",
    "instead. Each entry has a stable id that the in-app migration report, the docs",
    "site and support all use.",
    "",
    `**${GAP_CATALOG.length} known gaps** — ${bySeverity("high")} high, ${bySeverity("medium")} medium, ${bySeverity("low")} low.`,
    "",
    "Only the gaps that actually cost a given account something are shown in that",
    "account's migration report: extraction counts the affected source records, and a",
    "gap with a proven count of zero is dropped. A gap extraction could not probe is",
    'still shown — "we could not check" and "there is nothing there" must not look',
    "the same to somebody deciding whether to cut over.",
    ""
  ];

  for (const area of AREA_ORDER) {
    const gaps = GAP_CATALOG.filter((gap) => gap.area === area);
    if (gaps.length === 0) continue;
    lines.push(`## ${AREA_TITLES[area]}`, "");
    for (const gap of gaps) lines.push(renderGap(gap));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
