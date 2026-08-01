import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { feedbackValidator, setFeedback } from "~/modules/agent";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const validation = await validator(feedbackValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { threadId, feedback, note } = validation.data;
  const result = await setFeedback(client, {
    threadId,
    companyId,
    feedback,
    note
  });
  if (result.error) return { success: false };
  return { success: true };
}
