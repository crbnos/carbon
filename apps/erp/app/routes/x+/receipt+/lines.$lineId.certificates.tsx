import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { certificateValidator, getCertificates } from "~/modules/quality";
import {
  addReceiptLineCertificate,
  deleteReceiptLineCertificate
} from "~/modules/quality/certificates.server";
import { getDatabaseClient } from "~/services/database.server";

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

  const { lineId } = params;
  if (!lineId) throw notFound("lineId not found");

  // Adding and deleting are different permissions; the intent picks which.
  const formData = await request.formData();
  const isDelete = formData.get("intent") === "delete";
  const { client, companyId, userId } = await requirePermissions(
    request,
    isDelete ? { delete: "inventory" } : { create: "inventory" }
  );

  const line = await getReceiptLine(client, lineId, companyId);
  if (line.error || !line.data) {
    return { success: false, message: "Receipt line not found" };
  }

  if (isDelete) {
    const certificateId = formData.get("certificateId");
    if (typeof certificateId !== "string" || !certificateId) {
      return { success: false, message: "Certificate not found" };
    }

    // The id comes from the client: the delete is scoped to this line and
    // fails when it removed nothing.
    const result = await deleteReceiptLineCertificate(getDatabaseClient(), {
      id: certificateId,
      receiptLineId: lineId,
      companyId
    });
    if (result.error) {
      return { success: false, message: result.error.message };
    }
    return { success: true, message: "Certificate deleted" };
  }

  const validation = await validator(certificateValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  // The line comes from the URL, never the form; a client-sent document id
  // and job operation are ignored.
  const { type, certificateNumber, specification, notes, supplierId } =
    validation.data;

  let upload: { path: string; name: string; size: number } | undefined;
  const documentPath = formData.get("path");
  if (typeof documentPath === "string" && documentPath) {
    // Only register files uploaded to this line's folder of this company.
    if (!documentPath.startsWith(`${companyId}/inventory/${lineId}/`)) {
      return { success: false, message: "Invalid file path" };
    }
    const name = formData.get("name");
    const size = Number(formData.get("size"));
    upload = {
      path: documentPath,
      name: typeof name === "string" && name ? name : "certificate.pdf",
      size: Number.isFinite(size) ? size : 0
    };
  }

  const insert = await addReceiptLineCertificate(getDatabaseClient(), client, {
    companyId,
    userId,
    receiptLineId: lineId,
    receiptId: line.data.receiptId,
    certificate: {
      type,
      certificateNumber,
      specification,
      notes,
      supplierId
    },
    upload
  });
  if (insert.error) {
    return { success: false, message: insert.error.message };
  }

  return { success: true, message: "Certificate added" };
}
