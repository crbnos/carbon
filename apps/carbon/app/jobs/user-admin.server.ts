import { eventTrigger } from "@trigger.dev/sdk";
import { z } from "zod";

import { getSupabaseServiceRole } from "~/lib/supabase";
import { triggerClient } from "~/lib/trigger.server";
import { deactivateUser, resendInvite } from "~/modules/users/users.server";
import type { Result } from "~/types";

const supabaseClient = getSupabaseServiceRole();
export const userAdminSchema = z.object({
  id: z.string(),
  type: z.enum(["resend", "deactivate"]),
});

const job = triggerClient.defineJob({
  id: "user-admin",
  name: "User Admin",
  version: "0.0.1",
  trigger: eventTrigger({
    name: "user.admin",
    schema: userAdminSchema,
  }),
  run: async (payload, io, ctx) => {
    await io.logger.info(
      `🔰 User admin update ${payload.type} for ${payload.id}`
    );

    let result: Result;

    switch (payload.type) {
      case "resend":
        await io.logger.info(`📫 Resending invite for ${payload.id}`);
        result = await resendInvite(supabaseClient, payload.id);

        break;
      case "deactivate":
        await io.logger.info(`🚭 Deactivating ${payload.id}`);
        result = await deactivateUser(supabaseClient, payload.id);
        break;
      default:
        result = {
          success: false,
          message: `Invalid user admin type: ${payload.type}`,
        };
        break;
    }

    if (result.success) {
      await io.logger.info(`✅ Success ${payload.id}`);
    } else {
      await io.logger.error(
        `❌ Admin action ${payload.type} failed for ${payload.id}: ${result.message}`
      );
    }
  },
});

export default job;
