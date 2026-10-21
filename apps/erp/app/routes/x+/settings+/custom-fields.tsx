// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getAttributeDataTypes } from "~/modules/people/people.service";
import { getCustomFieldsTables } from "~/modules/settings/settings.service";
import { CustomFieldsTable } from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Custom Fields`,
  to: path.to.customFields
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [tables, dataTypes] = await Promise.all([
    getCustomFieldsTables(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getAttributeDataTypes(client)
  ]);

  if (tables.error) {
    redirect(
      path.to.authenticatedRoot,
      await flash(request, error(tables.error, "Failed to fetch custom fields"))
    );
  }

  return {
    count: tables.count ?? 0,
    tables: tables.data ?? [],
    dataTypes: dataTypes.data ?? []
  };
}

// Any record's properties panel posts here: the record ids, its table and
// the custom field values as one JSON string.
const customFieldsForm = z.object({
  ids: zfd.repeatable(z.array(z.string())),
  table: z.string().min(1, { message: "Invalid table" }),
  value: zfd.json(z.record(z.string(), z.unknown()))
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customFieldsForm).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const { ids, table, value } = input.data;
  return api.settings.setRecordCustomFields({
    table,
    ids,
    customFields: value
  });
}

export default function CustomFieldsRoute() {
  const { count, tables } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomFieldsTable data={tables} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
