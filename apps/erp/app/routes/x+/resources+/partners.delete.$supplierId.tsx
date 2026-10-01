// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deletePartner, getPartnerBySupplierId } from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { supplierId } = params;
  if (!supplierId) throw notFound("supplierId not found");

  const partner = await getPartnerBySupplierId(client, supplierId);
  if (partner.error) {
    throw redirect(
      path.to.partners,
      await flash(request, error(partner.error, "Failed to get partner"))
    );
  }

  return {
    partner: partner.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources"
  });

  const { supplierId } = params;
  if (!supplierId) {
    throw redirect(
      path.to.partners,
      await flash(request, error(params, "Failed to get partner id"))
    );
  }

  const { error: deletePartnerError } = await deletePartner(client, supplierId);
  if (deletePartnerError) {
    throw redirect(
      path.to.partners,
      await flash(
        request,
        error(deletePartnerError, "Failed to delete partner")
      )
    );
  }

  throw redirect(
    path.to.partners,
    await flash(request, success("Successfully deleted partner"))
  );
}

export default function DeletePartnerRoute() {
  const { partner } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  const onCancel = () => navigate(path.to.partners);

  if (!partner) return null;
  if (!partner.supplierLocationId)
    throw new Error("supplierLocationId is not found");
  const name = partner.supplierName ?? "";
  return (
    <ConfirmDelete
      action={path.to.deletePartner(partner.supplierLocationId)}
      name={name}
      text={t`Are you sure you want to delete the partner: ${name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
