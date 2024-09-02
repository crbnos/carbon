import {
  json,
  redirect,
  useLoaderData,
  useNavigate,
  useParams,
} from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import {
  CustomFieldForm,
  customFieldValidator,
  getCustomField,
} from "~/modules/settings";
import { DataType } from "~/modules/shared";
import { getParams, path } from "~/utils/path";

import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { upsertCustomField } from "~/modules/settings/settings.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost, notFound } from "~/utils/http";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "settings",
    role: "employee",
  });

  const { table, id } = params;
  if (!table) throw notFound("Invalid table");
  if (!id) throw new Error("id is not found");

  const customField = await getCustomField(client, id);
  if (customField.error) {
    throw redirect(
      path.to.customFieldList(table),
      await flash(
        request,
        error(customField.error, "Failed to fetch custom fields")
      )
    );
  }

  return json({ customField: customField.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
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
  if (!id) throw new Error("id is not found");

  const update = await upsertCustomField(client, {
    id,
    ...data,
    updatedBy: userId,
  });
  if (update.error) {
    return json(
      {},
      await flash(request, error(update.error, "Failed to update custom field"))
    );
  }

  throw redirect(`${path.to.customFieldList(table)}?${getParams(request)}`);
}

export default function UpdateCustomFieldRoute() {
  const { customField } = useLoaderData<typeof loader>();
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
        id: customField.id,
        name: customField.name,
        // @ts-expect-error
        dataTypeId: (customField.dataTypeId || DataType.Text).toString(),
        table: table,
        listOptions: customField.listOptions ?? [],
      }}
      dataTypes={routeData?.dataTypes ?? []}
      onClose={onClose}
    />
  );
}
