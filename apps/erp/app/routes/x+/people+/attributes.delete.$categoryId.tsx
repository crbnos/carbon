// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteAttributeCategory } from "~/modules/people";
import { path } from "~/utils/path";

export async function action({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "people"
  });

  const { categoryId } = params;
  if (!categoryId) {
    throw redirect(
      path.to.attributes,
      await flash(request, error(params, "Failed to get a category id"))
    );
  }

  const deactivateAttribute = await deleteAttributeCategory(client, categoryId);
  if (deactivateAttribute.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(
          deactivateAttribute.error,
          "Failed to deactivate attribute category"
        )
      )
    );
  }

  throw redirect(
    path.to.attributes,
    await flash(request, success("Successfully deactivated attribute category"))
  );
}
