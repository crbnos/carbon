// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { unchecked } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getAttributeDataTypes } from "~/modules/people";
import { CustomFieldsTable } from "~/modules/settings";
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

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const ids = formData.getAll("ids");
  const table = formData.get("table");
  const value = formData.get("value");

  if (typeof value !== "string" || typeof table !== "string") {
    return { error: { message: "Invalid table" }, data: null };
  }

  const result = await client
    // @ts-expect-error
    .from(table)
    .update(
      unchecked({
        customFields: JSON.parse(value),
        updatedBy: userId,
        updatedAt: new Date().toISOString()
      })
    )
    .in(getIdField(table), ids as string[]);

  return result;
}

function getIdField(table: string) {
  switch (table) {
    case "part":
    case "material":
    case "consumable":
    case "tool":
    case "fixture":
    default:
      return "id";
  }
}

export default function CustomFieldsRoute() {
  const { count, tables, nextCursor } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <CustomFieldsTable data={tables} count={count} nextCursor={nextCursor} />
      <RecordOutlet />
    </VStack>
  );
}
