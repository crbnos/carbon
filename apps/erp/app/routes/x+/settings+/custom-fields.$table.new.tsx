// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { CustomFieldForm, customFieldValidator } from "~/modules/settings";
import { upsertCustomField } from "~/modules/settings/settings.server";
import { DataType } from "~/modules/shared";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "settings"
  });

  const { table } = params;
  if (!table) throw new Error("table is not found");

  const validation = await validator(customFieldValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const create = await upsertCustomField(client, {
    ...d,
    companyId,
    createdBy: userId
  });
  if (create.error) {
    return data(
      {},
      await flash(request, error(create.error, "Failed to insert custom field"))
    );
  }

  throw redirect(`${path.to.customFieldList(table)}?${getParams(request)}`);
}

export default function NewCustomFieldRoute() {
  const { table } = useParams();
  if (!table) throw new Error("table is not found");

  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const routeData = useRouteData<{
    dataTypes: AttributeDataType[];
  }>(path.to.customFields);

  return (
    <CustomFieldForm
      initialValues={{
        name: "",
        // @ts-ignore
        dataTypeId: DataType.Text.toString(),
        table: table,
        tags: []
      }}
      dataTypes={routeData?.dataTypes ?? []}
      onClose={onClose}
    />
  );
}
