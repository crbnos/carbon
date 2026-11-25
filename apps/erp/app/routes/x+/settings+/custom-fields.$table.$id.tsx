// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people/types";
import { customFieldValidator } from "~/modules/settings/settings.models";
import { CustomFieldForm } from "~/modules/settings/ui";
import { DataType } from "~/modules/shared/types";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "settings.customFields": "View" });

  const { table, id } = params;
  if (!table) throw notFound("Invalid table");
  if (!id) throw new Error("id is not found");

  const customField = await api.settings.getCustomField({ id });
  if (customField.error) {
    throw redirect(
      path.to.customFieldList(table),
      await flash(
        request,
        error(customField.error, "Failed to fetch custom fields")
      )
    );
  }

  return { customField: customField.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customFieldValidator).request(args, {
    params: ["table"]
  });
  if ("invalid" in input) return input.invalid;
  const { id, name, listOptions, tags, required } = input.data;
  if (!id) throw new Error("id is not found");
  const { api } = await authorize(args.request);
  const result = await api.settings.updateCustomField({
    id,
    name,
    listOptions,
    tags,
    required
  });
  return respond(args.request, result).redirect(
    `${path.to.customFieldList(input.params.table)}?${getParams(args.request)}`
  );
}

export default function UpdateCustomFieldRoute() {
  const { customField } = useLoaderData<typeof loader>();
  const { table } = useParams();
  if (!table) throw new Error("table is not found");

  const dialog = useRouteDialog();
  const onClose = dialog.close;
  const routeData = useRouteData<{
    dataTypes: AttributeDataType[];
  }>(path.to.customFields);

  return (
    <CustomFieldForm
      initialValues={{
        id: customField.id,
        name: customField.name,
        // @ts-expect-error
        dataTypeId: (customField.dataTypeId || DataType.Text).toString(),
        table: table,
        listOptions: customField.listOptions ?? [],
        tags: customField.tags ?? []
      }}
      dataTypes={routeData?.dataTypes ?? []}
      open={dialog.open}
      onClose={onClose}
    />
  );
}
