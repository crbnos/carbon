// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs } from "react-router";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people/types";
import { customFieldValidator } from "~/modules/settings/settings.models";
import { CustomFieldForm } from "~/modules/settings/ui";
import { DataType } from "~/modules/shared/types";
import { getParams, path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(customFieldValidator).request(args, {
    params: ["table"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...field } = input.data;
  const { api } = await authorize(args.request);
  const result = await api.settings.createCustomField(field);
  return respond(args.request, result).redirect(
    `${path.to.customFieldList(input.params.table)}?${getParams(args.request)}`
  );
}

export default function NewCustomFieldRoute() {
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
        name: "",
        // @ts-expect-error
        dataTypeId: DataType.Text.toString(),
        table: table,
        tags: []
      }}
      dataTypes={routeData?.dataTypes ?? []}
      open={dialog.open}
      onClose={onClose}
    />
  );
}
