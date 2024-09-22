import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { AttributeForm, getAttribute } from "~/modules/people";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "people",
    role: "employee",
  });

  const { categoryId, attributeId } = params;
  if (!attributeId) throw notFound("attributeId not found");
  if (!categoryId) throw notFound("categoryId not found");

  const attribute = await getAttribute(client, attributeId);
  if (attribute.error) {
    throw redirect(
      path.to.attributeCategoryList(categoryId),
      await flash(request, error(attribute.error, "Failed to fetch attribute"))
    );
  }

  return json({
    attribute: attribute.data,
  });
}

export default function EditAttributeRoute() {
  const { attribute } = useLoaderData<typeof loader>();
  const { categoryId } = useParams();
  if (!categoryId) throw new Error("categoryId is not found");
  if (Number.isNaN(categoryId)) throw new Error("categoryId is not a number");

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.attributeCategoryList(categoryId));
  const attributesRouteData = useRouteData<{
    dataTypes: AttributeDataType[];
  }>(path.to.attributes);

  return (
    <AttributeForm
      key={`${attribute.id}${categoryId}`}
      initialValues={{
        id: attribute?.id,
        name: attribute?.name,
        // @ts-ignore
        attributeDataTypeId: attribute?.attributeDataTypeId.toString(),
        userAttributeCategoryId: attribute?.userAttributeCategoryId,
        canSelfManage: attribute.canSelfManage ?? true,
        listOptions: attribute?.listOptions ?? [],
      }}
      dataTypes={attributesRouteData?.dataTypes ?? []}
      onClose={onClose}
    />
  );
}
