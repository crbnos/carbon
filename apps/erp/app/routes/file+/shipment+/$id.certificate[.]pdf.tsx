import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import {
  getCertificateOfConformancePreviewHeader,
  renderCertificateOfConformancePdf
} from "~/modules/inventory/inventory.server";

const logger = getLogger("erp", "shipment", "certificate-preview");

/** Live, watermarked preview of a shipment's Certificate of Conformance. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) {
    logger.error("Missing shipment id", { companyId });
    throw new Response("Shipment not found", { status: 404 });
  }

  const { locale } = getPreferenceHeaders(request);
  const certificate = await getCertificateOfConformancePreviewHeader(client, {
    companyId,
    shipmentId: id,
    userId
  });

  const pdf = await renderCertificateOfConformancePdf(client, {
    companyId,
    shipmentId: id,
    locale,
    certificate
  });

  if (pdf.error) {
    logger.error("Failed to render certificate preview", {
      companyId,
      shipmentId: id,
      error: pdf.error
    });
    const status = pdf.error.message === "Shipment not found" ? 404 : 500;
    throw new Response(pdf.error.message, { status });
  }

  return new Response(pdf.data, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Certificate of Conformance (PREVIEW).pdf"`
    }
  });
}
