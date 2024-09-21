import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { getSupabaseServiceRole } from "~/lib/supabase";
import type { Result } from "~/types";
import { recalculateJobRequirements } from "../modules/production/production.service";

const recalculateSchema = z.object({
  type: z.enum(["jobRequirements"]),
  id: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

export const recalculateTask = task({
  id: "recalculate",
  run: async (payload: z.infer<typeof recalculateSchema>) => {
    console.info(`🔰 Type: ${payload.type}, id: ${payload.id}`);

    const serviceRole = getSupabaseServiceRole();
    let result: Result;

    switch (payload.type) {
      case "jobRequirements":
        console.info(`📊 Recalculating job requirements for ${payload.id}`);
        const calculateQuantities = await recalculateJobRequirements(
          serviceRole,
          {
            id: payload.id,
            companyId: payload.companyId,
            userId: payload.userId,
          }
        );

        result = {
          success: !calculateQuantities.error,
          message: calculateQuantities.error?.message,
        };
        break;
      default:
        result = {
          success: false,
          message: `Unknown recalculation type: ${payload.type}`,
        };
        break;
    }

    if (result.success) {
      console.info(`✅ Success ${payload.id}`);
    } else {
      console.error(
        `❌ Recalculation ${payload.type} failed for ${payload.id}: ${result.message}`
      );
    }

    return result;
  },
});
