// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { modulePreferencesValidator } from "~/modules/users/users.models";
import { upsertModulePreferences } from "~/modules/users/users.service";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {});

  const body = modulePreferencesValidator.safeParse(await request.json());

  if (!body.success) {
    return data({ error: "Invalid preferences format" }, { status: 400 });
  }

  const result = await upsertModulePreferences(
    client,
    userId,
    companyId,
    body.data.preferences
  );

  if (result.error) {
    return data({ error: result.error.message }, { status: 500 });
  }

  return data({ success: true });
}
