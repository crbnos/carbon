import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { getAttribute } from "~/modules/people/people.service.server";
import { AttributeForm } from "~/modules/people/ui/Attributes";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "people",
    role: "employee"
  });

  const { categoryId, attributeId } = params;
  if (!attributeId) throw notFound("attributeId not found");
  if (!categoryId) throw notFound("categoryId not found");

  const attribute = await getAttribute(attributeId);
  if (attribute.error) {
    throw redirect(
      path.to.attributeCategoryList(categoryId),
      await flash(request, error(attribute.error, "Failed to fetch attribute"))
    );
  }

  return {
    attribute: attribute.data
  };
}

export default function EditAttributeRoute() {
  const { attribute } = useLoaderData<typeof loader>();
  const { categoryId } = useParams();
  if (!categoryId) throw new Error("categoryId is not found");
  if (Number.isNaN(categoryId)) throw new Error("categoryId is not a number");

  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const attributesRouteData = useRouteData<{
    dataTypes: AttributeDataType[];
  }>(path.to.attributes);

  return (
    <AttributeForm
      key={`${attribute.id}${categoryId}`}
      initialValues={{
        id: attribute?.id,
        name: attribute?.name,
        // @ts-expect-error
        attributeDataTypeId: attribute?.attributeDataTypeId.toString(),
        userAttributeCategoryId: attribute?.userAttributeCategoryId,
        canSelfManage: attribute.canSelfManage ?? true,
        listOptions: attribute?.listOptions ?? []
      }}
      // @ts-expect-error TS2322 - TODO: fix type
      dataTypes={attributesRouteData?.dataTypes ?? []}
      onClose={onClose}
    />
  );
}
