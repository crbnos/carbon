import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { certificateOfConformanceSendValidator } from "~/modules/inventory";
import { sendCertificateOfConformance } from "~/modules/inventory/inventory.server";

const logger = getLogger("erp", "shipment", "certificate-send");

/** Email an issued certificate revision to a customer contact. */
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { shipmentId, certificateId } = params;
  if (!shipmentId || !certificateId) {
    logger.error("Missing shipment or certificate id", { companyId });
    throw new Response("Certificate not found", { status: 404 });
  }

  const validation = await validator(
    certificateOfConformanceSendValidator
  ).validate(await request.formData());
  if (validation.error) {
    return validationError(validation.error);
  }

  const { locale } = getPreferenceHeaders(request);
  const sent = await sendCertificateOfConformance(client, {
    companyId,
    shipmentId,
    userId,
    certificateOfConformanceId: certificateId,
    customerContactId: validation.data.customerContact,
    cc: validation.data.cc,
    locale
  });

  if (sent.error) {
    return data(
      { success: false, message: sent.error.message },
      await flash(request, error(sent.error, sent.error.message))
    );
  }

  const message = `Certificate of Conformance emailed to ${sent.data.to.join(", ")}`;
  return data(
    { success: true, message },
    await flash(request, success(message))
  );
}
