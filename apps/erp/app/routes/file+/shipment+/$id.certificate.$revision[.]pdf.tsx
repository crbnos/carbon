import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { getIssuedCertificateOfConformancePdf } from "~/modules/inventory/inventory.server";

const logger = getLogger("erp", "shipment", "certificate-download");

/** The stored PDF of an issued certificate revision — never re-rendered. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id, revision } = params;
  const revisionNumber = Number(revision);
  if (!id || !Number.isInteger(revisionNumber) || revisionNumber < 0) {
    logger.error("Invalid certificate download request", {
      companyId,
      shipmentId: id,
      revision
    });
    throw new Response("Certificate not found", { status: 404 });
  }

  const file = await getIssuedCertificateOfConformancePdf(client, {
    companyId,
    shipmentId: id,
    revision: revisionNumber
  });

  if (file.error) {
    logger.error("Failed to load issued certificate", {
      companyId,
      shipmentId: id,
      revision: revisionNumber,
      error: file.error
    });
    const status = file.error.message === "Certificate not found" ? 404 : 500;
    throw new Response(file.error.message, { status });
  }

  return new Response(file.data.bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file.data.fileName}"`
    }
  });
}
