import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useNavigate } from "@remix-run/react";
import { useRouteData, useUrlParams } from "~/hooks";
import type { AttributeDataType } from "~/modules/resources";
import { CustomFieldsTableDetail, getCustomFields } from "~/modules/settings";
import { updateCustomFieldsSortOrder } from "~/modules/settings/settings.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost, notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee",
  });

  const { table } = params;
  if (!table) throw notFound("Invalid table");

  const customFields = await getCustomFields(client, table, companyId);

  if (customFields.error) {
    throw redirect(
      path.to.customFields,
      await flash(
        request,
        error(customFields.error, "Failed to fetch custom fields")
      )
    );
  }

  return json({ customFields: customFields.data });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "resources",
  });

  const updateMap = (await request.formData()).get("updates") as string;
  if (!updateMap) {
    return json(
      {},
      await flash(request, error(null, "Failed to receive a new sort order"))
    );
  }

  const updates = Object.entries(JSON.parse(updateMap)).map(
    ([id, sortOrderString]) => ({
      id,
      sortOrder: Number(sortOrderString),
      updatedBy: userId,
    })
  );

  const updateSortOrders = await updateCustomFieldsSortOrder(client, updates);
  if (updateSortOrders.some((update) => update.error))
    return json(
      {},
      await flash(
        request,
        error(updateSortOrders, "Failed to update sort order")
      )
    );

  return null;
}

export default function CustomFieldsListRoute() {
  const { customFields } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{ dataTypes: AttributeDataType[] }>(
    path.to.customFields
  );
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const onClose = () =>
    navigate(`${path.to.customFields}?${params.toString()}`);

  return (
    <>
      <CustomFieldsTableDetail
        customFieldTable={customFields}
        dataTypes={routeData?.dataTypes ?? []}
        onClose={onClose}
      />
      <Outlet />
    </>
  );
}
