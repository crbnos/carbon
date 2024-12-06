import { assertIsPost, error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Outlet, useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useUrlParams } from "~/hooks";
import {
  getAttributeCategory,
  updateAttributeSortOrder,
} from "~/modules/people";
import { AttributeCategoryDetail } from "~/modules/people/ui/Attributes";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const { categoryId } = params;
  if (!categoryId) throw notFound("Invalid categoryId");

  const attributeCategory = await getAttributeCategory(client, categoryId);
  if (attributeCategory.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(attributeCategory.error, "Failed to fetch attribute category")
      )
    );
  }

  return json({ attributeCategory: attributeCategory.data });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "people",
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

  const updateSortOrders = await updateAttributeSortOrder(client, updates);
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

export default function AttributeCategoryListRoute() {
  const { attributeCategory } = useLoaderData<typeof loader>();
  const [params] = useUrlParams();
  const navigate = useNavigate();
  const onClose = () => navigate(`${path.to.attributes}?${params.toString()}`);

  return (
    <>
      <AttributeCategoryDetail
        attributeCategory={attributeCategory}
        onClose={onClose}
      />
      <Outlet />
    </>
  );
}
