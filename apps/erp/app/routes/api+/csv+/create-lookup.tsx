import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { type CreatableLookup, creatableLookups } from "~/modules/shared";

const inputSchema = z.object({
  lookup: z.enum(creatableLookups),
  names: z.array(z.string().trim().min(1)).min(1).max(100)
});

// Creating a lookup is gated by the module that owns it. Record<CreatableLookup, ...>
// keeps this map exhaustive: adding a lookup without a permission fails typecheck.
const lookupPermissions: Record<CreatableLookup, "purchasing" | "sales"> = {
  supplierType: "purchasing",
  customerType: "sales",
  customerStatus: "sales"
};

const normalize = (value: string) => value.toLowerCase().trim();

// Create name-only lookup values during CSV import. Accepts a batch (a single
// inline create sends a one-element array). Idempotent: existing values are
// matched case-insensitively and returned instead of created, and intra-batch
// case variants converge on one row. Results answer every input name so the
// client can link each id back to the CSV value that asked for it.
export async function action({ request }: ActionFunctionArgs) {
  const parsed = inputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return { error: "Invalid create-lookup request" };
  }
  const { lookup, names } = parsed.data;

  const { client, companyId, userId } = await requirePermissions(request, {
    create: lookupPermissions[lookup]
  });

  // One read, one bulk insert. The lookup value is the table name (constrained
  // by the zod enum above), and all three tables share the same name-only shape
  // with a unique (name, companyId) constraint.
  const existing = await client
    .from(lookup)
    .select("id, name")
    .eq("companyId", companyId);
  if (existing.error) {
    return { error: existing.error.message };
  }

  const rowByName = new Map(
    existing.data.map((row) => [normalize(row.name), row])
  );

  const missing = [
    ...new Map(
      names
        .filter((name) => !rowByName.has(normalize(name)))
        .map((name) => [normalize(name), name])
    ).values()
  ];

  if (missing.length > 0) {
    const inserted = await client
      .from(lookup)
      .insert(missing.map((name) => ({ name, companyId, createdBy: userId })))
      .select("id, name");
    if (inserted.error) {
      return { error: inserted.error.message };
    }
    for (const row of inserted.data) {
      rowByName.set(normalize(row.name), row);
    }
  }

  return {
    results: names.map((name) => {
      const row = rowByName.get(normalize(name));
      return row
        ? { id: row.id, name: row.name }
        : { name, error: "Could not create value" };
    })
  };
}
