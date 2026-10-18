// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { AttributeDataType } from "~/modules/people/types";
import { AttributeForm } from "~/modules/people/ui/Attributes";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "people",
    role: "employee"
  });
  const api = carbonFor(auth);

  const { categoryId, attributeId } = params;
  if (!attributeId) throw notFound("attributeId not found");
  if (!categoryId) throw notFound("categoryId not found");

  const attribute = await api.people.getAttribute({ attributeId });
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

  const closeRoute = useCloseRoute();
  const onClose = () => closeRoute();
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
