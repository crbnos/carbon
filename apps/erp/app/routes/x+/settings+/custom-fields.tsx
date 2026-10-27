// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getAttributeDataTypes } from "~/modules/people/people.service";
import { CustomFieldsTable } from "~/modules/settings/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { customFieldTablesList } from "~/utils/list-registry/settings.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Custom Fields`,
  to: path.to.customFields
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, customFieldTablesList, {
    dataKey: "tables",
    firstPage: async ({ client }) => {
      const dataTypes = await getAttributeDataTypes(client);
      return { dataTypes: dataTypes.data ?? [] };
    },
    onError: {
      redirectTo: path.to.authenticatedRoot,
      message: "Failed to fetch custom fields"
    }
  });
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
  const { count, tables, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomFieldsTable data={tables} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
