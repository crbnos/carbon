// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteMaterialForm } from "~/modules/items/items.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, { "parts.shapes": "View" });
  const { formId } = params;
  if (!formId) throw notFound("formId not found");

  const materialForm = await api.items.getMaterialForm({ id: formId });
  if (materialForm.error) {
    throw redirect(
      path.to.materialForms,
      await flash(
        request,
        error(materialForm.error, "Failed to get material form")
      )
    );
  }

  return { materialForm: materialForm.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await authorize(request, { "parts.shapes": "Full" });

  const { formId } = params;
  if (!formId) {
    throw redirect(
      path.to.materialForms,
      await flash(request, error(params, "Failed to get an material form id"))
    );
  }

  const { error: deleteTypeError } = await deleteMaterialForm(client, formId);
  if (deleteTypeError) {
    throw redirect(
      `${path.to.materialForms}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete material form")
      )
    );
  }

  throw redirect(
    path.to.materialForms,
    await flash(request, success("Successfully deleted material form"))
  );
}

export default function DeleteMaterialFormRoute() {
  const { formId } = useParams();
  if (!formId) throw new Error("formId not found");

  const { materialForm } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const { t } = useLingui();

  if (!materialForm) return null;

  const onCancel = () => closeRoute();

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialForm(formId)}
      name={materialForm.name}
      text={t`Are you sure you want to delete the material form: ${materialForm.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
