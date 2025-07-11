import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { customerPortalValidator } from "~/modules/sales";
import CustomerPortalForm from "~/modules/sales/ui/CustomerPortals/CustomerPortalForm";
import { upsertExternalLink } from "~/modules/shared";

import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "sales",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "sales",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(customerPortalValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { customerId } = validation.data;

  const insertCustomerPortal = await upsertExternalLink(client, {
    documentType: "Customer",
    documentId: customerId,
    customerId,
    companyId,
  });

  if (insertCustomerPortal.error) {
    return modal
      ? json(insertCustomerPortal)
      : redirect(
          requestReferrer(request) ??
            `${path.to.customerPortals}?${getParams(request)}`,
          await flash(
            request,
            error(
              insertCustomerPortal.error,
              "Failed to create customer portal"
            )
          )
        );
  }

  return modal
    ? json(insertCustomerPortal)
    : redirect(
        `${path.to.customerPortals}?${getParams(request)}`,
        await flash(request, success("Customer portal created"))
      );
}

export default function NewCustomerPortalRoute() {
  const navigate = useNavigate();
  const initialValues = {
    customerId: "",
  };

  return (
    <CustomerPortalForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
