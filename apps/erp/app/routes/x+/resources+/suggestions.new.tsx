import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { NotificationEvent } from "@carbon/notifications";
import type { ActionFunctionArgs } from "react-router";
import { getCompany } from "~/modules/settings/settings.service.server";
import { suggestionValidator } from "~/modules/shared";
import { AuthClientScope } from "~/services/mcp/index.server";

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
    userId: formUserId
  } = validation.data;
  const serviceRole = await getCarbonServiceRole();
  // getCompany is clientless and resolves its client from AuthClientScope.
  // On main it was called with serviceRole (this is a no-permission route);
  // pin the scope to serviceRole to keep that RLS-bypass behavior.
  AuthClientScope.setFactory(() => serviceRole);

  const insertSuggestion = await serviceRole
    .from("suggestion")
    .insert([
      {
        suggestion,
        emoji,
        path,
        attachmentPath: attachmentPath || null,
        userId: formUserId || null,
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

  const company = await getCompany();

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
        from: formUserId || userId
      });
    } catch (err) {
      console.error("Failed to trigger suggestion notification", err);
    }
  }

  return { success: true, message: "Suggestion submitted" };
}
