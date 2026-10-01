// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteSupplierQuote } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const quoteDelete = await deleteSupplierQuote(client, id);

  if (quoteDelete.error) {
    return data(
      path.to.supplierQuotes,
      await flash(request, error(quoteDelete.error, quoteDelete.error.message))
    );
  }

  throw redirect(path.to.supplierQuotes);
}
