import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { upsertDocument } from "~/modules/documents";
import {
  certificateValidator,
  deleteCertificate,
  getCertificates,
  upsertCertificate
} from "~/modules/quality";

async function getReceiptLine(
  client: Awaited<ReturnType<typeof requirePermissions>>["client"],
  lineId: string,
  companyId: string
) {
  return client
    .from("receiptLine")
    .select("id, receiptId, receipt(id, supplierId)")
    .eq("id", lineId)
    .eq("companyId", companyId)
    .maybeSingle();
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const [line, certificates] = await Promise.all([
    getReceiptLine(client, lineId, companyId),
    getCertificates(client, companyId, { receiptLineIds: [lineId] })
  ]);

  if (line.error || !line.data) throw notFound("Receipt line not found");

  return {
    certificates: certificates.data ?? [],
    supplierId: line.data.receipt?.supplierId ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  const line = await getReceiptLine(client, lineId, companyId);
  if (line.error || !line.data) {
    return { success: false, message: "Receipt line not found" };
  }

  const formData = await request.formData();

  if (formData.get("intent") === "delete") {
    const certificateId = formData.get("certificateId");
    if (typeof certificateId !== "string" || !certificateId) {
      return { success: false, message: "Certificate not found" };
    }

    // The id comes from the client: only delete it when it belongs to this line.
    const existing = await getCertificates(client, companyId, {
      ids: [certificateId]
    });
    if (existing.data?.[0]?.receiptLineId !== lineId) {
      return { success: false, message: "Certificate not found" };
    }

    const result = await deleteCertificate(client, certificateId, companyId);
    if (result.error) {
      return { success: false, message: result.error.message };
    }
    return { success: true, message: "Certificate deleted" };
  }

  const validation = await validator(certificateValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: the line comes from the URL, not the form
  const { id, receiptLineId, jobOperationId, documentId, ...certificate } =
    validation.data;

  let uploadedDocumentId: string | undefined;
  const documentPath = formData.get("path");
  if (typeof documentPath === "string" && documentPath) {
    // Only register files uploaded to this line's folder of this company.
    if (!documentPath.startsWith(`${companyId}/inventory/${lineId}/`)) {
      return { success: false, message: "Invalid file path" };
    }

    const name = formData.get("name");
    const size = Number(formData.get("size"));

    // documentSourceTypes (documents.models) omits "Receipt", which the
    // document table's enum has — the receipt-line upload path uses it too.
    const source: Record<string, string> = {
      sourceDocument: "Receipt",
      sourceDocumentId: line.data.receiptId
    };

    const document = await upsertDocument(client, {
      path: documentPath,
      name: typeof name === "string" && name ? name : "certificate.pdf",
      size: Number.isFinite(size) ? size : 0,
      ...source,
      readGroups: [userId],
      writeGroups: [userId],
      createdBy: userId,
      companyId
    });
    if (document.error || !document.data) {
      return {
        success: false,
        message: document.error?.message ?? "Failed to create document"
      };
    }
    uploadedDocumentId = document.data.id;
  }

  const insert = await upsertCertificate(client, {
    ...certificate,
    receiptLineId: lineId,
    documentId: uploadedDocumentId,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    return { success: false, message: insert.error.message };
  }

  return { success: true, message: "Certificate added" };
}
