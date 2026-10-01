// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteProductionQuantity } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const deletion = await deleteProductionQuantity(client, id);
  if (deletion.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.jobs,
      await flash(request, error(deletion.error, "Failed to delete quantity"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.jobs,
    await flash(request, success("Successfully deleted quantity"))
  );
}
