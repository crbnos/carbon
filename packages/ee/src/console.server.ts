import type { Database } from "@carbon/database";
import { sanitize } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEntitlement } from "./entitlements.server";

/**
 * Commercial (Enterprise) console / kiosk mode. Enabling it provisions the
 * protected "Console Operator" employee type (MES-only permissions) and a PIN
 * for the enabling user — role provisioning, gated to the Business plan via the
 * `PERMISSIONS` feature. The console settings route
 * (`apps/erp/.../x+/settings+/people.tsx`) blocks this for Community/Starter
 * before calling it; the `.server` file is server-only and the `@carbon/ee`
 * package boundary carries the commercial license (see root LICENSE).
 */
export async function updateConsoleSetting(
  client: SupabaseClient<Database>,
  companyId: string,
  consoleEnabled: boolean,
  userId?: string
) {
  await requireEntitlement(client, companyId, "PERMISSIONS");
  const update = await client
    .from("companySettings")
    .update(sanitize({ consoleEnabled }) as any)
    .eq("id", companyId);

  // When enabling, create "Console Operator" employee type if it doesn't exist
  if (consoleEnabled) {
    const existing = await client
      .from("employeeType")
      .select("id")
      .eq("companyId", companyId)
      .eq("systemType", "Console Operator")
      .maybeSingle();

    if (!existing.data) {
      const newType = await client
        .from("employeeType")
        .insert({
          name: "Console Operator",
          companyId,
          protected: true,
          systemType: "Console Operator"
        })
        .select("id")
        .single();

      // Create default permissions for the Console Operator type.
      // Only grant what's needed for MES operations — not ERP modules.
      if (newType.data) {
        const mesModules = [
          {
            module: "Production",
            create: true,
            update: true,
            delete: false,
            view: true
          },
          {
            module: "Inventory",
            create: true,
            update: true,
            delete: false,
            view: true
          },
          {
            module: "Resources",
            create: false,
            update: false,
            delete: false,
            view: true
          },
          {
            module: "Items",
            create: false,
            update: false,
            delete: false,
            view: true
          },
          {
            module: "Quality",
            create: true,
            update: true,
            delete: false,
            view: true
          },
          {
            module: "People",
            create: false,
            update: false,
            delete: false,
            view: true
          }
        ];

        const permissions = mesModules.map((m) => ({
          employeeTypeId: newType.data.id,
          module: m.module as "Accounting",
          create: m.create ? [companyId] : [],
          update: m.update ? [companyId] : [],
          delete: m.delete ? [companyId] : [],
          view: m.view ? [companyId] : []
        }));

        await client.from("employeeTypePermission").insert(permissions);
      }
    }

    // Auto-generate a PIN for the enabling user if they don't have one
    let generatedPin: string | null = null;
    if (userId) {
      const userEmployee = await client
        .from("employee")
        .select("id, pin" as any)
        .eq("id", userId)
        .eq("companyId", companyId)
        .maybeSingle();

      if (userEmployee.data && !(userEmployee.data as any).pin) {
        generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
        await client
          .from("employee")
          .update({ pin: generatedPin } as any)
          .eq("id", userId)
          .eq("companyId", companyId);
      }
    }
  }

  return update;
}
