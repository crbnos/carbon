import { json, redirect, useNavigate, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { CustomFieldForm, customFieldValidator } from "~/modules/settings";
import { DataType } from "~/modules/shared";
import { getParams, path } from "~/utils/path";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { upsertCustomField } from "~/modules/settings/settings.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "settings",
  });

  const { table } = params;
  if (!table) throw new Error("table is not found");

  const validation = await validator(customFieldValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const create = await upsertCustomField(client, {
    ...data,
    companyId,
    createdBy: userId,
  });
  if (create.error) {
    return json(
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
        tags: [],
      }}
      dataTypes={routeData?.dataTypes ?? []}
      onClose={onClose}
    />
  );
}
