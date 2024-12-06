import { useNavigate, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { AttributeForm } from "~/modules/people/ui/Attributes";

import { DataType } from "~/modules/shared";
import { path } from "~/utils/path";

export default function NewAttributeRoute() {
  const { categoryId } = useParams();
  if (!categoryId) throw new Error("categoryId is not found");

  const navigate = useNavigate();
  const onClose = () => navigate(-1);
  const attributesRouteData = useRouteData<{
    dataTypes: AttributeDataType[];
  }>(path.to.attributes);

  return (
    <AttributeForm
      initialValues={{
        name: "",
        // @ts-ignore
        attributeDataTypeId: DataType.Text.toString(),
        userAttributeCategoryId: categoryId,
        canSelfManage: true,
      }}
      dataTypes={attributesRouteData?.dataTypes ?? []}
      onClose={onClose}
    />
  );
}
