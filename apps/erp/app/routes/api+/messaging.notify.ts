import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { notifyTask } from "@carbon/jobs/trigger/notify";
import { NotificationEvent } from "@carbon/notifications";
import { tasks } from "@trigger.dev/sdk/v3";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { z } from "zod";

export const config = {
  runtime: "nodejs",
};

export const messagingNotifySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("jobOperationNote"),
    operationId: z.string(),
  }),
]);

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const payload = messagingNotifySchema.safeParse(await request.json());

  if (payload.success) {
    switch (payload.data.type) {
      case "jobOperationNote":
        const { operationId } = payload.data;

        const [job, previousMessages] = await Promise.all([
          client
            .from("jobOperation")
            .select("*, job(id, assignee), jobMakeMethod(id, parentMaterialId)")
            .eq("id", operationId)
            .single(),
          client
            .from("jobOperationNote")
            .select("*")
            .eq("jobOperationId", operationId),
        ]);

        const assignee = job.data?.job?.assignee;
        const jobId = job.data?.job?.id;
        const makeMethodId = job.data?.jobMakeMethod?.id;
        const materialId = job.data?.jobMakeMethod?.parentMaterialId;

        const usersToNotify = [
          ...new Set([
            ...(previousMessages.data?.map((m) => m.createdBy) ?? []).filter(
              (id) => id !== userId
            ),
          ]),
        ];

        if (assignee && assignee !== userId) {
          usersToNotify.push(assignee);
        }

        if (usersToNotify.length > 0) {
          const notificationEvent = getNotificationEvent("jobOperationNote");
          if (notificationEvent) {
            await tasks.trigger<typeof notifyTask>("notify", {
              companyId,
              documentId: `${jobId}:${operationId}:${makeMethodId}:${
                materialId ?? ""
              }`,
              event: notificationEvent,
              recipient: {
                type: "users",
                userIds: usersToNotify,
              },
              from: userId,
            });
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
