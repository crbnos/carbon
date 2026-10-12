// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useCloseRoute } from "@carbon/react";
import { useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people";
import { AttributeForm } from "~/modules/people/ui/Attributes";
import { DataType } from "~/modules/shared";
import { path } from "~/utils/path";

export default function NewAttributeRoute() {
  const { categoryId } = useParams();
  if (!categoryId) throw new Error("categoryId is not found");

  const closeRoute = useCloseRoute();
  const onClose = () => closeRoute();
  const attributesRouteData = useRouteData<{
    dataTypes: AttributeDataType[];
  }>(path.to.attributes);

  return (
    <AttributeForm
      initialValues={{
        name: "",
        // @ts-expect-error
        attributeDataTypeId: DataType.Text.toString(),
        userAttributeCategoryId: categoryId,
        canSelfManage: false
      }}
      // @ts-expect-error TS2322 - TODO: fix type
      dataTypes={attributesRouteData?.dataTypes ?? []}
      onClose={onClose}
    />
  );
}
