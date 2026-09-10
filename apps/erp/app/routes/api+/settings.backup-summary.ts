import { requirePermissions } from "@carbon/auth/auth.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LoaderFunctionArgs } from "react-router";
import { BACKUP_SUMMARY_GROUPS } from "~/modules/settings/backups.areas";
import { canAccessBackups } from "~/utils/backups";

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
  if (!canAccessBackups(email))
    throw new Response("Not found", { status: 404 });

  // Keys and counts only — the popover owns the labels (msg descriptors it
  // resolves client-side), so no display copy crosses the wire.
  const groups = await Promise.all(
    BACKUP_SUMMARY_GROUPS.map(async (group) => {
      const rows = await Promise.all(
        group.entities.map(async ([, table, scope]) => ({
          table,
          count:
            scope === "group"
              ? await countEntity(
                  client,
                  table,
                  "companyGroupId",
                  companyGroupId
                )
              : await countEntity(client, table, "companyId", companyId)
        }))
      );
      const subtotal = rows.reduce((sum, r) => sum + r.count, 0);
      return { area: group.area, rows, subtotal };
    })
  );

  const total = groups.reduce((sum, g) => sum + g.subtotal, 0);
  return { groups, total };
}
