import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

import { getCarbonServiceRole } from "@carbon/auth";
import { deactivateUser, resendInvite } from "~/modules/users/users.server";
import type { Result } from "~/types";

const serviceRole = getCarbonServiceRole();
export const userAdminSchema = z.object({
  id: z.string(),
  type: z.enum(["resend", "deactivate"]),
  companyId: z.string(),
});

export const userAdminTask = task({
  id: "user-admin",
  run: async (payload: z.infer<typeof userAdminSchema>) => {
    console.log(`🔰 User admin update ${payload.type} for ${payload.id}`);

    let result: Result;

    switch (payload.type) {
      case "resend":
        console.log(`📫 Resending invite for ${payload.id}`);
        result = await resendInvite(serviceRole, payload.id);
        break;
      case "deactivate":
        console.log(`🚭 Deactivating ${payload.id}`);
        result = await deactivateUser(
          serviceRole,
          payload.id,
          payload.companyId
        );
        break;
      default:
        result = {
          success: false,
          message: `Invalid user admin type: ${payload.type}`,
        };
        break;
    }

    if (result.success) {
      console.log(`✅ Success ${payload.id}`);
    } else {
      console.error(
        `❌ Admin action ${payload.type} failed for ${payload.id}: ${result.message}`
      );
    }

    return result;
  },
});
