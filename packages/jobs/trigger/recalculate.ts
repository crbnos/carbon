import { getCarbonServiceRole } from "@carbon/auth";
import type { FunctionsResponse } from "@supabase/functions-js";
import { task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const recalculateSchema = z.object({
  type: z.enum(["jobRequirements", "jobMakeMethodRequirements"]),
  id: z.string(),
  companyId: z.string(),
  userId: z.string(),
});

export const recalculateTask = task({
  id: "recalculate",
  run: async (payload: z.infer<typeof recalculateSchema>) => {
    console.info(`🔰 Type: ${payload.type}, id: ${payload.id}`);

    const serviceRole = getCarbonServiceRole();
    let result: { success: boolean; message: string };
    let calculateQuantities: FunctionsResponse<{ success: boolean }>;

    switch (payload.type) {
      case "jobRequirements":
        console.info(`📊 Recalculating job requirements for ${payload.id}`);
        calculateQuantities = await recalculateJobRequirements(serviceRole, {
          id: payload.id,
          companyId: payload.companyId,
          userId: payload.userId,
        });

        result = {
          success: !calculateQuantities.error,
          message: calculateQuantities.error?.message,
        };
        break;
      case "jobMakeMethodRequirements":
        console.info(
          `📊 Recalculating job make method requirements for ${payload.id}`
        );
        calculateQuantities = await recalculateJobMakeMethodRequirements(
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

async function recalculateJobRequirements(
  client,
  params: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("recalculate", {
    body: {
      type: "jobRequirements",
      ...params,
    },
  });
}

async function recalculateJobMakeMethodRequirements(
  client,
  params: {
    id: string;
    companyId: string;
    userId: string;
  }
) {
  return client.functions.invoke("scheduler", {
    body: {
      type: "make-method-requirements",
      ...params,
    },
  });
}
