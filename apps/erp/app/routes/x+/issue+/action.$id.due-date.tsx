// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";

const updateDueDateSchema = zfd.formData({
  id: z.string(),
  dueDate: z.string().optional()
});

export async function action({ request }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "quality"
  });

  const formData = await request.formData();
  const validated = await validator(updateDueDateSchema).validate(formData);
  if (validated.error) {
    return data({ error: "Invalid form data" }, { status: 400 });
  }

  const { error } = await client
    .from("nonConformanceActionTask")
    .update({
      dueDate: validated.data.dueDate || null
    })
    .eq("id", validated.data.id);

  if (error) {
    return data({ error: error.message }, { status: 400 });
  }

  return { success: true };
}
