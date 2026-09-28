import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  certificateOfConformanceIssueValidator,
  getCertificateOfConformanceData,
  getCertificateOfConformanceDefaults,
  getCertificatesOfConformance
} from "~/modules/inventory";
import {
  issueCertificateOfConformance,
  sendCertificateOfConformance
} from "~/modules/inventory/inventory.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "shipment", "certificate");

/**
 * The shipment's issued certificates and who they go to. `?warnings=true`
 * adds the issue dialog's warnings (FAI due, missing certificates), which
 * walk lineage and so are only computed when the dialog opens.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) {
    logger.error("Missing shipment id", { companyId });
    throw new Response("Shipment not found", { status: 404 });
  }

  const withWarnings =
    new URL(request.url).searchParams.get("warnings") === "true";
  const { locale } = getPreferenceHeaders(request);

  const [certificates, defaults, content] = await Promise.all([
    getCertificatesOfConformance(client, companyId, shipmentId),
    getCertificateOfConformanceDefaults(client, companyId, shipmentId),
    withWarnings
      ? getCertificateOfConformanceData(client, companyId, shipmentId, {
          locale
        })
      : Promise.resolve(null)
  ]);

  if (certificates.error) {
    logger.error("Failed to load certificates of conformance", {
      shipmentId,
      error: certificates.error
    });
  }
  if (defaults.error) {
    logger.error("Failed to load certificate defaults", {
      shipmentId,
      error: defaults.error
    });
  }
  if (content?.error) {
    logger.error("Failed to load certificate warnings", {
      shipmentId,
      error: content.error
    });
  }

  return {
    certificates: certificates.data ?? [],
    customerId: defaults.data?.customerId ?? null,
    defaultContactId: defaults.data?.defaultContactId ?? null,
    warnings: content?.data?.warnings ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { shipmentId } = params;
  if (!shipmentId) {
    logger.error("Missing shipment id", { companyId });
    throw new Response("Shipment not found", { status: 404 });
  }

  const validation = await validator(
    certificateOfConformanceIssueValidator
  ).validate(await request.formData());
  if (validation.error) {
    return validationError(validation.error);
  }

  const { reasonForUpdate, email, customerContact, cc } = validation.data;
  const { locale } = getPreferenceHeaders(request);

  const issued = await issueCertificateOfConformance(
    getDatabaseClient(),
    client,
    { companyId, shipmentId, userId, reasonForUpdate, locale }
  );
  if (issued.error) {
    return data(
      { success: false, message: issued.error.message },
      await flash(request, error(issued.error, issued.error.message))
    );
  }

  const number = issued.data.number;
  if (!email || !customerContact) {
    return data(
      { success: true, message: `Certificate of Conformance ${number} issued` },
      await flash(
        request,
        success(`Certificate of Conformance ${number} issued`)
      )
    );
  }

  const sent = await sendCertificateOfConformance(client, {
    companyId,
    shipmentId,
    userId,
    certificateOfConformanceId: issued.data.id,
    customerContactId: customerContact,
    cc,
    locale,
    content: issued.data.content
  });
  if (sent.error) {
    // The certificate is issued either way; only the email failed.
    const message = `Certificate of Conformance ${number} issued, but the email could not be sent: ${sent.error.message}`;
    return data(
      { success: true, message },
      await flash(request, error(sent.error, message))
    );
  }

  const message = `Certificate of Conformance ${number} issued and emailed to ${sent.data.to.join(", ")}`;
  return data(
    { success: true, message },
    await flash(request, success(message))
  );
}
