import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet, useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData, useUrlParams } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { CustomFieldsTableDetail, getCustomFields } from "~/modules/settings";
import { updateCustomFieldsSortOrder } from "~/modules/settings/settings.server";
import { path } from "~/utils/path";

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
