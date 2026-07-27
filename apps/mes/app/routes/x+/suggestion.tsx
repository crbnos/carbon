import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { postSuggestionToCarbonSlack } from "@carbon/lib/slack.server";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { suggestionValidator } from "~/services/models";

const log = getLogger("mes");

export async function action({ request }: ActionFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(suggestionValidator).validate(formData);

  if (validation.error) {
    return {
      success: false,
      message: "Failed to submit suggestion"
    };
  }

  const {
    attachmentPath,
    emoji,
    suggestion,
    path,
    userId: formUserId,
    sendToCarbon
  } = validation.data;

  // formUserId is only an anonymous on/off signal — attribute the session user or nobody
  const suggestionUserId = formUserId ? userId : null;
  const suggestionAttachmentPath =
    attachmentPath && attachmentPath.startsWith(`${companyId}/suggestions/`)
      ? attachmentPath
      : null;

  const serviceRole = await getCarbonServiceRole();

  const insertSuggestion = await serviceRole
    .from("suggestion")
    .insert([
      {
        suggestion,
        emoji,
        path,
        attachmentPath: suggestionAttachmentPath,
        userId: suggestionUserId,
        companyId
      }
    ])
    .select("id")
    .single();

  if (insertSuggestion.error) {
    return {
      success: false,
      message: "Failed to submit suggestion"
    };
  }

  const company = await serviceRole
    .from("company")
    .select("name, suggestionNotificationGroup")
    .eq("id", companyId)
    .single();

  if (sendToCarbon) {
    await postSuggestionToCarbonSlack(serviceRole, {
      companyId,
      companyName: company.data?.name,
      suggestion,
      emoji,
      path,
      userId: suggestionUserId,
      attachmentPath: suggestionAttachmentPath
    });
  }

  if (!company.error && company.data?.suggestionNotificationGroup?.length) {
    try {
      await trigger("notify", {
        companyId,
        documentId: insertSuggestion.data.id,
        event: NotificationEvent.SuggestionResponse,
        recipient: {
          type: "group",
          groupIds: company.data.suggestionNotificationGroup
        },
        from: suggestionUserId || userId
      });
    } catch (err) {
      log.error("Failed to trigger suggestion notification", { error: err });
    }
  }

  return { success: true, message: "Suggestion submitted" };
}
