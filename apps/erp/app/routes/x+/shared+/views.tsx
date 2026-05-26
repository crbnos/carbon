import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import {
  savedViewStateValidator,
  savedViewValidator
} from "~/modules/shared/shared.models";

import { upsertSavedView } from "~/modules/shared/shared.service.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {});

  const formData = await request.formData();
  const validation = await validator(savedViewValidator).validate(formData);

  if (validation.error) {
    return {
      success: false,
      id: null,
      message: "Invalid form data"
    };
  }

  const { state, ...d } = validation.data;

  try {
    const parsedState = JSON.parse(state);
    const validatedState = savedViewStateValidator.parse(parsedState);

    const result = await upsertSavedView({
      ...d,
      ...validatedState
    });

    if (result.error) {
      console.error(result.error);
      return {
        success: false,
        id: null,
        message: result.error.message
      };
    }

    if (d.id) {
      return {
        success: true,
        id: d.id,
        message: "View updated"
      };
    }

    return {
      success: true,
      id: result.data.id,
      message: "View saved"
    };
  } catch (_error) {
    return {
      success: false,
      id: null,
      message: "Invalid state"
    };
  }
}
