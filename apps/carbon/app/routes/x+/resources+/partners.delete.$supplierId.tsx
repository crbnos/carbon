import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deletePartner, getPartnerBySupplierId } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
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

  return json({
    partner: partner.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources",
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

  const onCancel = () => navigate(path.to.partners);

  if (!partner) return null;
  if (!partner.supplierLocationId)
    throw new Error("supplierLocationId is not found");

  return (
    <ConfirmDelete
      action={path.to.deletePartner(partner.supplierLocationId)}
      name={partner.supplierName ?? ""}
      text={`Are you sure you want to delete the partner: ${
        partner.supplierName ?? ""
      }? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
