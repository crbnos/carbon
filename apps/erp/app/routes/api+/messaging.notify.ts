import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { NotificationEvent } from "@carbon/notifications";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";
import type { notifyTask } from "~/trigger/notify";

export const config = {
  runtime: "nodejs",
};

export const messagingNotifySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("jobOperationNote"),
    source: z.enum(["erp", "mes"]).optional(),
    operationId: z.string(),
  }),
]);

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const payload = messagingNotifySchema.safeParse(await request.json());

  if (payload.success) {
    switch (payload.data.type) {
      case "jobOperationNote":
        const { source, operationId } = payload.data;

        if (source === "mes") {
          const data = await client
            .from("jobOperation")
            .select("*, job(id, assignee), jobMakeMethod(id, parentMaterialId)")
            .eq("id", operationId)
            .single();
          const assignee = data.data?.job?.assignee;
          const jobId = data.data?.job?.id;
          const makeMethodId = data.data?.jobMakeMethod?.id;
          const materialId = data.data?.jobMakeMethod?.parentMaterialId;

          if (assignee) {
            const notificationEvent = getNotificationEvent("jobOperationNote");
            if (notificationEvent) {
              await tasks.trigger<typeof notifyTask>("notify", {
                companyId,
                documentId: `${jobId}:${operationId}:${makeMethodId}:${
                  materialId ?? ""
                }`,
                event: notificationEvent,
                recipient: {
                  type: "user",
                  userId: assignee,
                },
                from: userId,
              });
            }
          }
        }

        break;
      default:
        return json(
          { success: false },
          await flash(request, error(null, "Invalid payload"))
        );
    }

    return json({ success: true });
  } else {
    return json(
      { success: false },
      await flash(request, error(null, "Failed to notify user"))
    );
  }
}

function getNotificationEvent(table: string): NotificationEvent | null {
  switch (table) {
    case "jobOperationNote":
      return NotificationEvent.JobOperationMessage;
    default:
      return null;
  }
}
