import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { updatePermissions } from "~/modules/users/users.server";

const supabaseClient = getSupabaseServiceRole();
export const permissionsUpdateSchema = z.object({
  id: z.string(),
  addOnly: z.boolean(),
  permissions: z.record(
    z.string(),
    z.object({
      view: z.boolean(),
      create: z.boolean(),
      update: z.boolean(),
      delete: z.boolean(),
    })
  ),
  companyId: z.string(),
});

export const updatePermissionsTask = task({
  id: "update-permissions",
  run: async (payload: z.infer<typeof permissionsUpdateSchema>) => {
    console.info(`🔰 Permission Update for ${payload.id}`);
    const { success, message } = await updatePermissions(
      supabaseClient,
      payload
    );
    if (success) {
      console.info(`✅ Permission Update for ${payload.id}`);
    } else {
      console.error(`❌ Permission Update for ${payload.id}: ${message}`);
    }
    return { success, message };
  },
});
