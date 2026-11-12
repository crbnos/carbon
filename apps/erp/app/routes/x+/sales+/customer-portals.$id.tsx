// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { upsertCustomerPortal } from "@carbon/ee/customer-portals.server";
import { requireFeature } from "@carbon/ee/plan.server";
import { validationError, validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { datetime, redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { customerPortalValidator } from "~/modules/sales/sales.models";
import {
  getCustomerPortal,
  getCustomerPortalReleaseOptions
} from "~/modules/sales/sales.service";
import {
  customerPortalExpiresAt,
  customerPortalExpiryDate,
  customerPortalExpiryRefused
} from "~/modules/sales/sales.utils";
import CustomerPortalForm from "~/modules/sales/ui/CustomerPortals/CustomerPortalForm.ee";
import { getCompanyTimeZone } from "~/modules/shared/shared.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const customerPortal = await getCustomerPortal(client, id, companyId);

  if (customerPortal.error) {
    throw redirect(
      path.to.customerPortals,
      await flash(
        request,
        error(customerPortal.error, "Failed to get customer portal")
      )
    );
  }

  const [timeZone, releaseOptions] = await Promise.all([
    getCompanyTimeZone(client, companyId),
    getCustomerPortalReleaseOptions(client, {
      companyId,
      customerId: customerPortal.data.customerId ?? ""
    })
  ]);
  if (releaseOptions.error) {
    throw new Error("Failed to load customer portal documents");
  }

  return {
    customerPortal: customerPortal.data,
    expiresOn: customerPortalExpiryDate(
      customerPortal.data.expiresAt,
      timeZone
    ),
    releaseOptions: releaseOptions.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  await requireFeature({
    request,
    client,
    companyId,
    feature: "CUSTOMER_PORTALS",
    redirectTo: path.to.customerPortals
  });

  const formData = await request.formData();
  if (formData.get("intent") === "releaseDocument") {
    const portalId = params.id;
    const documentId = formData.get("documentId");
    const documentType = formData.get("documentType");
    if (
      !portalId ||
      typeof documentId !== "string" ||
      !documentId ||
      (documentType !== "CoC" && documentType !== "Test Report")
    ) {
      return data({ releaseError: "Choose a PDF and document type" });
    }
    const api = await carbon(request);
    const released = await api.sales.releaseCustomerPortalDocument({
      portalId,
      documentId,
      documentType
    });
    return data(
      released.error
        ? { releaseError: released.error.message }
        : { released: true }
    );
  }
  const validation = await validator(customerPortalValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, customerId, expiresOn } = validation.data;
  if (!id) throw new Error("id not found");
  const [timeZone, stored] = await Promise.all([
    getCompanyTimeZone(client, companyId),
    getCustomerPortal(client, id, companyId)
  ]);
  if (stored.error) {
    return data(
      {},
      await flash(request, error(stored.error, "Failed to get customer portal"))
    );
  }
  const storedExpiresAt = stored.data.expiresAt;
  // An unchanged date keeps the stored instant, which a later change of the
  // company's timezone moves off local midnight.
  const expiresAt =
    expiresOn &&
    expiresOn === customerPortalExpiryDate(storedExpiresAt, timeZone)
      ? storedExpiresAt
      : customerPortalExpiresAt(expiresOn, timeZone);
  if (
    customerPortalExpiryRefused(
      expiresAt,
      storedExpiresAt,
      datetime.timestamp()
    )
  ) {
    return validationError({
      fieldErrors: { expiresOn: "Choose a day after today" }
    });
  }

  const updateCustomerPortal = await upsertCustomerPortal(client, companyId, {
    id,
    documentType: "Customer",
    documentId: customerId,
    customerId,
    // A blank date clears the expiry.
    expiresAt
  });

  if (updateCustomerPortal.error) {
    return data(
      {},
      await flash(
        request,
        error(updateCustomerPortal.error, "Failed to update customer portal")
      )
    );
  }

  throw redirect(
    path.to.customerPortals,
    await flash(request, success("Updated customer portal"))
  );
}

export default function EditCustomerPortalRoute() {
  const { customerPortal, expiresOn, releaseOptions } =
    useLoaderData<typeof loader>();
  const dialog = useRouteDialog();

  const initialValues = {
    id: customerPortal.id ?? undefined,
    customerId: customerPortal.customerId ?? "",
    expiresOn
  };

  return (
    <CustomerPortalForm
      key={initialValues.id}
      initialValues={initialValues}
      open={dialog.open}
      onClose={dialog.close}
      releaseOptions={releaseOptions}
    />
  );
}
