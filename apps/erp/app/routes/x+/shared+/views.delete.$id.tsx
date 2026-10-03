// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteSavedView } from "~/modules/shared";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteView = await deleteSavedView(client, id);
  if (deleteView.error) {
    return data(
      {
        id: null
      },
      await flash(request, error(deleteView.error, "Failed to delete view"))
    );
  }

  const referrerPath = requestReferrer(request)?.split(/[?#]/)[0] ?? null;

  throw redirect(referrerPath ?? path.to.authenticatedRoot);
}
