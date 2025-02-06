import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import {
  savedViewStateValidator,
  savedViewValidator,
} from "~/modules/shared/shared.models";

import { upsertSavedView } from "~/modules/shared/shared.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(savedViewValidator).validate(formData);

  if (validation.error) {
    return json({
      success: false,
      message: "Invalid form data",
    });
  }

  const { state, ...data } = validation.data;

  try {
    const parsedState = JSON.parse(state);
    const validatedState = savedViewStateValidator.parse(parsedState);

    const result = await upsertSavedView(client, {
      ...data,
      ...validatedState,
      userId,
      companyId,
    });

    if (result.error) {
      console.error(result.error);
      return json({
        success: false,
        message: result.error.message,
      });
    }

    return json({
      success: true,
      message: "View saved",
    });
  } catch (error) {
    return json({
      success: false,
      message: "Invalid state",
    });
  }
}
