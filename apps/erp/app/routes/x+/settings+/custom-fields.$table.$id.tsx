import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { CustomFieldForm, customFieldValidator } from "~/modules/settings";
import { upsertCustomField } from "~/modules/settings/settings.server";
import { getCustomField } from "~/modules/settings/settings.service.server";
import { DataType } from "~/modules/shared";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const { table, id } = params;
  if (!table) throw notFound("Invalid table");
  if (!id) throw new Error("id is not found");

  const customField = await getCustomField(id);
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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
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

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id is not found");

  const update = await upsertCustomField(client, {
    id,
    ...d,
    updatedBy: userId
  });
  if (update.error) {
    return data(
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
        tags: customField.tags ?? []
      }}
      dataTypes={routeData?.dataTypes ?? []}
      onClose={onClose}
    />
  );
}
