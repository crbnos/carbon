import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  ItemGroupForm,
  itemGroupValidator,
  upsertItemGroup,
} from "~/modules/parts";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(itemGroupValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertItemGroup = await upsertItemGroup(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertItemGroup.error) {
    return json(
      {},
      await flash(
        request,
        error(insertItemGroup.error, "Failed to insert item group")
      )
    );
  }

  const itemGroupId = insertItemGroup.data?.id;
  if (!itemGroupId) {
    return json(
      {},
      await flash(
        request,
        error(insertItemGroup, "Failed to insert item group")
      )
    );
  }

  return modal
    ? json(insertItemGroup, { status: 201 })
    : redirect(
        `${path.to.itemGroups}?${getParams(request)}`,
        await flash(request, success("Part group created"))
      );
}

export default function NewItemGroupsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    description: "",
  };

  return (
    <ItemGroupForm onClose={() => navigate(-1)} initialValues={initialValues} />
  );
}
