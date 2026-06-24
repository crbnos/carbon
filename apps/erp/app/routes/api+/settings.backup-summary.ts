import { requirePermissions } from "@carbon/auth/auth.server";
import { isInternalEmail } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";

// Recognizable entities a backup carries, grouped for the "what's in a backup"
// popover. Not exhaustive (the export covers every scoped table) — just the
// meaningful headline counts. `scope` is the column rows are counted by:
// "company" (companyId, the default) or "group" (companyGroupId — the shared
// chart of accounts / currencies / dimensions).
type Scope = "company" | "group";
type Entity = [label: string, table: string, scope?: Scope];

const GROUPS: { title: string; entities: Entity[] }[] = [
  {
    title: "Sales",
    entities: [
      ["Customers", "customer"],
      ["Quotes", "quote"],
      ["Sales orders", "salesOrder"],
      ["Sales invoices", "salesInvoice"],
      ["Shipments", "shipment"]
    ]
  },
  {
    title: "Purchasing",
    entities: [
      ["Suppliers", "supplier"],
      ["Purchase orders", "purchaseOrder"],
      ["Purchase invoices", "purchaseInvoice"],
      ["Receipts", "receipt"]
    ]
  },
  {
    title: "Items",
    entities: [
      ["Parts", "part"],
      ["Materials", "material"],
      ["Tools", "tool"]
    ]
  },
  {
    title: "Production",
    entities: [
      ["Jobs", "job"],
      ["Work centers", "workCenter"],
      ["Processes", "process"]
    ]
  },
  {
    title: "Accounting",
    entities: [
      ["Accounts", "account", "group"],
      ["Currencies", "currency", "group"],
      ["Dimensions", "dimension", "group"],
      ["Journal lines", "journalLine"],
      ["Item ledger", "itemLedger"],
      ["Cost ledger", "costLedger"]
    ]
  },
  {
    title: "Quality",
    entities: [
      ["Non-conformances", "nonConformance"],
      ["Gauges", "gauge"]
    ]
  },
  { title: "People", entities: [["Employees", "employee"]] }
];

async function countEntity(
  client: SupabaseClient,
  table: string,
  column: string,
  value: string | null
): Promise<number> {
  if (!value) return 0;
  try {
    const { count } = await client
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq(column, value);
    return count ?? 0;
  } catch {
    return 0;
  }
}

// Lazy-loaded by the backup-contents popover (only when opened). Returns a
// headline row count per entity, grouped, plus a grand total.
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId, email } = await requirePermissions(
    request,
    { view: "settings" }
  );
  if (!isInternalEmail(email)) throw new Response("Not found", { status: 404 });

  const groups = await Promise.all(
    GROUPS.map(async (group) => {
      const rows = await Promise.all(
        group.entities.map(async ([label, table, scope]) =>
          scope === "group"
            ? {
                label,
                count: await countEntity(
                  client,
                  table,
                  "companyGroupId",
                  companyGroupId
                )
              }
            : {
                label,
                count: await countEntity(client, table, "companyId", companyId)
              }
        )
      );
      const subtotal = rows.reduce((sum, r) => sum + r.count, 0);
      return { title: group.title, rows, subtotal };
    })
  );

  const total = groups.reduce((sum, g) => sum + g.subtotal, 0);
  return { groups, total };
}
