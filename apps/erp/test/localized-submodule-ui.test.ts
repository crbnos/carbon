import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "app");

const files = [
  "modules/sales/ui/Customers/CustomersTable.tsx",
  "modules/sales/ui/Quotes/QuotesTable.tsx",
  "modules/sales/ui/SalesRFQ/SalesRFQsTable.tsx",
  "modules/sales/ui/SalesOrder/SalesOrdersTable.tsx",
  "modules/sales/ui/Customer/CustomerHeader.tsx",
  "modules/sales/ui/Quotes/QuoteHeader.tsx",
  "modules/sales/ui/SalesRFQ/SalesRFQHeader.tsx",
  "modules/sales/ui/SalesOrder/SalesOrderHeader.tsx",
  "modules/sales/ui/SalesOrder/SalesOrderSummary.tsx",
  "modules/invoicing/ui/SalesInvoice/SalesInvoicesTable.tsx",
  "modules/invoicing/ui/PurchaseInvoice/PurchaseInvoicesTable.tsx",
  "modules/invoicing/ui/PurchaseInvoice/PurchaseInvoiceHeader.tsx"
];

const forbiddenPatterns: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /header:\s*"[^"]+"/g,
    description: "raw string table header"
  },
  {
    pattern: /pluralHeader:\s*"[^"]+"/g,
    description: "raw string plural header"
  },
  {
    pattern: /title="[^"]+"/g,
    description: "raw string title prop"
  },
  {
    pattern: /<New\s+label="[^"]+"/g,
    description: "raw string New label"
  },
  {
    pattern: />\s*Edit\s*</g,
    description: "raw Edit menu label"
  },
  {
    pattern: />\s*Delete\s*</g,
    description: "raw Delete menu label"
  },
  {
    pattern: /text=\{`Are you sure you want to delete[\s\S]*?This cannot be undone\.`\}/g,
    description: "raw delete confirmation text"
  },
  {
    pattern:
      /aria-label="(?:Toggle Explorer|More options|Toggle Properties)"/g,
    description: "raw header aria label"
  },
  {
    // Requires a non-whitespace character: once the `<Trans>` children are
    // stripped above, a correctly localized label is left as an element
    // containing only the newline and indentation it was written across, and
    // `[^<{]+` alone would match that whitespace and report it as raw.
    pattern: /<CardAttributeLabel>\s*[^<{\s][^<{]*<\/CardAttributeLabel>/g,
    description: "raw card attribute label"
  },
  {
    pattern:
      />\s*(?:Delete Customer|Delete RFQ|Delete Quote|Delete Sales Order|Delete Purchase Invoice|Share|Preview|Finalize|Won|Lost|Cancel|Reopen|Ready for Quote|Quote|No Quote|Post|Payment|Purchase Order|Purchase Orders|Receipt|Receipts|Confirm|New Shipment|New Invoice|Shipments|Ship|Invoices|Invoice|Create Jobs|Edit Shipping|Add Shipping)\s*</g,
    description: "raw header action label"
  }
];

describe("localized sales and invoicing submodule UI", () => {
  test("avoids raw UI strings in localized table and header screens", () => {
    const offenders: string[] = [];

    for (const relativePath of files) {
      const source = readFileSync(join(root, relativePath), "utf8");
      const sanitizedSource = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        // Strip already-localized JSX before scanning. The `>Label<` patterns
        // below cannot see element boundaries, and `<Trans>Edit</Trans>`
        // literally contains `>Edit<` — so without this every correctly
        // localized label reported itself as a raw one, and the suite could
        // only be satisfied by UNDOING the localization it exists to enforce.
        .replace(/<Trans[^>]*>[\s\S]*?<\/Trans>/g, "");

      for (const { pattern, description } of forbiddenPatterns) {
        // `RegExp.test` on a /g regex advances `lastIndex` and the object is
        // shared across every file in this loop, so a match in one file made
        // the next file start mid-string and silently under-report. Reset per
        // use rather than dropping the /g flag, which the descriptions rely on.
        pattern.lastIndex = 0;
        if (pattern.test(sanitizedSource)) {
          offenders.push(`${relativePath}: ${description}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
