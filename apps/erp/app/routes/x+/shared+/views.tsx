import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  savedViewStateValidator,
  savedViewValidator
} from "~/modules/shared/shared.models";
import { upsertSavedView } from "~/modules/shared/shared.service";

const logger = getLogger("erp", "views");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {});

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

    const result = await upsertSavedView(client, {
      ...d,
      ...validatedState,
      userId,
      companyId
    });

    if (result.error) {
      logger.error(result.error);
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
