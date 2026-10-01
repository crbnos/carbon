// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { revisionValidator } from "~/modules/items/items.models";
import { updateRevision } from "~/modules/items/items.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) {
    return {
      success: false,
      message: "Revision ID is required"
    };
  }

  const formData = await request.formData();
  const validation = await validator(revisionValidator).validate(formData);

  if (validation.error) {
    return {
      success: false,
      message: "Invalid form data"
    };
  }

  const result = await updateRevision(client, {
    id: id,
    revision: validation.data.revision,
    updatedBy: userId
  });

  if (result.error) {
    return {
      success: false,
      message: result.error.message || "Failed to update revision"
    };
  }

  return {
    success: true,
    link: `/x/items/${id}` // Redirect back to the item
  };
}
