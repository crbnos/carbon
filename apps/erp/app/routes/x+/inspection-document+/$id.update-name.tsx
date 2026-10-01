// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { invalidateInspectionDocuments } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const drawingNumber = String(formData.get("drawingNumber") ?? "").trim();

  const result = await (client as any)
    .from("inspectionDocument")
    .update({
      drawingNumber: drawingNumber || null,
      updatedBy: userId,
      updatedAt: new Date().toISOString()
    })
    .eq("id", id);

  if (result.error) {
    return { success: false };
  }

  return { success: true };
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateInspectionDocuments();
  return await serverAction();
}
