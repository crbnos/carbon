// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { table, id } = params;

  if (!table || !id)
    return {
      data: []
    };

  const values = await client.rpc("get_custom_field_unique_values", {
    table_name: table,
    field_key: id,
    company_id: companyId
  });
  if (values.error) {
    return data(
      [],
      await flash(
        request,
        error(values.error, "Failed to get unique values for custom field")
      )
    );
  }

  const options = values.data.map((value) => ({
    id: value.value,
    name: value.value
  }));

  return { data: options, error: null };
}
