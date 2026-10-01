// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteQualityDocument } from "~/modules/quality/quality.service";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deleteQualityDocument(client, id);
  if (mutation.error) {
    return data(
      {
        success: false
      },
      await flash(
        request,
        error(mutation.error, "Failed to delete quality document")
      )
    );
  }

  throw redirect(
    path.to.qualityDocuments,
    await flash(request, success("Successfully deleted quality document"))
  );
}
