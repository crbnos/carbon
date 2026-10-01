// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { insertTag } from "~/modules/shared";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const name = formData.get("name");
  const table = formData.get("table");

  if (typeof name !== "string" || typeof table !== "string") {
    return data(
      { success: false, message: "Invalid form data" },
      { status: 400 }
    );
  }

  const tag = await insertTag(client, {
    name,
    table,
    companyId,
    createdBy: userId
  });

  if (tag.error) {
    return data(
      { success: false, message: tag.error.message },
      { status: 500 }
    );
  }

  return { success: true, tag };
}
