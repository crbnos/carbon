// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAssemblyInstructionStepSlide } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { slideId } = params;
  if (!slideId) throw new Error("slideId is not found");

  const deleteSlide = await deleteAssemblyInstructionStepSlide(client, slideId);
  if (deleteSlide.error) {
    return data(
      { success: false },
      await flash(request, error(deleteSlide.error, "Failed to delete slide"))
    );
  }

  return { success: true };
}
