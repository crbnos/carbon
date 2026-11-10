// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost } from "@carbon/auth";
import { validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import {
  savedViewStateValidator,
  savedViewValidator
} from "~/modules/shared/shared.models";

const logger = getLogger("erp", "views");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
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

    const api = await carbon(request);
    const result = await api.shared.upsertSavedView({
      ...d,
      ...validatedState
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
      id: result.data?.id ?? null,
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
