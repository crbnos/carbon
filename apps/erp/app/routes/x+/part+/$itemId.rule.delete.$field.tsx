// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { deleteConfigurationRule } from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "parts"
  });

  const { itemId, field } = params;
  if (!itemId || !field) throw notFound("itemId or field not found");

  const remove = await deleteConfigurationRule(client, field, itemId);

  if (remove.error) {
    return {
      success: false,
      error: "Failed to delete configuration rule"
    };
  }

  return {
    success: true
  };
}
