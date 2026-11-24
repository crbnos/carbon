// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";

export const messagingNotifySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("jobOperationNote"),
    operationId: z.string(),
    // Optional: a tablet still running an older MES build sends none.
    noteId: z.string().optional()
  })
]);

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const payload = messagingNotifySchema.safeParse(await request.json());

  if (payload.success) {
    switch (payload.data.type) {
      case "jobOperationNote":
        const { operationId, noteId } = payload.data;

        const [job, previousMessages, note] = await Promise.all([
          client
            .from("jobOperation")
            .select("*, job(id, assignee), jobMakeMethod(id, parentMaterialId)")
            .eq("id", operationId)
            .single(),
          client
            .from("jobOperationNote")
            .select("*")
            .eq("jobOperationId", operationId),
          // Only the sender's own note on this operation becomes the message.
          noteId
            ? client
                .from("jobOperationNote")
                .select("note")
                .eq("id", noteId)
                .eq("jobOperationId", operationId)
                .eq("createdBy", userId)
                .eq("companyId", companyId)
                .maybeSingle()
            : null
        ]);

        const assignee = job.data?.job?.assignee;
        const jobId = job.data?.job?.id;
        const makeMethodId = job.data?.jobMakeMethod?.id;
        const materialId = job.data?.jobMakeMethod?.parentMaterialId;

        const usersToNotify = [
          ...new Set([
            ...(previousMessages.data?.map((m) => m.createdBy) ?? []).filter(
              (id) => id !== userId
            )
          ])
        ];

        if (assignee && assignee !== userId) {
          usersToNotify.push(assignee);
        }

        if (usersToNotify.length > 0) {
          const notificationEvent = getNotificationEvent("jobOperationNote");
          if (notificationEvent) {
            await trigger("notify", {
              companyId,
              documentId: `${jobId}:${operationId}:${makeMethodId}:${
                materialId ?? ""
              }`,
              event: notificationEvent,
              recipient: {
                type: "users",
                userIds: usersToNotify
              },
              from: userId,
              body: note?.data?.note
            });
          }
        }

        break;
      default:
        return data(
          { success: false },
          await flash(request, error(null, "Invalid payload"))
        );
    }

    return { success: true };
  } else {
    return data(
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
