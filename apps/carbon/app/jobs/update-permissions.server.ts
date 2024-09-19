import { eventTrigger } from "@trigger.dev/sdk";
import { z } from "zod";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";
import { updatePermissions } from "~/modules/users/users.server";

export const config = { runtime: "nodejs" };

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

const job = triggerClient.defineJob({
  id: "update-permissions",
  name: "Update Permissions",
  version: "0.0.1",
  trigger: eventTrigger({
    name: "update.permissions",
    schema: permissionsUpdateSchema,
  }),
  run: async (payload, io, ctx) => {
    await io.logger.info(`🔰 Permission Update for ${payload.id}`);
    const { success, message } = await updatePermissions(
      supabaseClient,
      payload
    );
    if (success) {
      await io.logger.info(`✅ Permission Update for ${payload.id}`);
    } else {
      await io.logger.error(
        `❌ Permission Update for ${payload.id}: ${message}`
      );
    }
  },
});

export default job;
