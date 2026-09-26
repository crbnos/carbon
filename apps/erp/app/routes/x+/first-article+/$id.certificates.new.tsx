import { assertIsPost, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { upsertDocument } from "~/modules/documents";
import { certificateValidator, upsertCertificate } from "~/modules/quality";
import { refreshFirstArticleProducts } from "~/modules/quality/firstArticle.server";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "first-article", "certificates");

// "Attach certificate" on FAI Form 2: a special-process or functional-test
// certificate on one of the make method's operations, then a refresh so the
// new certificate lands on Form 2. Answers the CertificateForm fetcher with
// { success, message }.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
    update: "quality"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const fai = await client
    .from("firstArticleInspection")
    .select("status, jobId, jobMakeMethodId")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (fai.error || !fai.data) {
    return { success: false, message: "First article not found" };
  }
  if (fai.data.status !== "Draft") {
    return { success: false, message: "This first article is locked" };
  }

  const formData = await request.formData();
  const validation = await validator(certificateValidator).validate(formData);
  if (validation.error) {
    return validationError(validation.error);
  }

  // A job-operation certificate: never a receipt line, never a client-sent
  // document id.
  const {
    type,
    certificateNumber,
    specification,
    notes,
    supplierId,
    jobOperationId
  } = validation.data;

  // The operation comes from the client: it must belong to this FAI's make
  // method.
  const operation = await client
    .from("jobOperation")
    .select("id")
    .eq("id", jobOperationId ?? "")
    .eq("jobMakeMethodId", fai.data.jobMakeMethodId)
    .eq("companyId", companyId)
    .maybeSingle();
  if (operation.error || !operation.data) {
    return { success: false, message: "Operation not found" };
  }

  let uploadedDocumentId: string | undefined;
  const documentPath = formData.get("path");
  if (typeof documentPath === "string" && documentPath) {
    // Only register files uploaded to this job's folder of this company.
    if (!documentPath.startsWith(`${companyId}/job/${fai.data.jobId}/`)) {
      return { success: false, message: "Invalid file path" };
    }

    const name = formData.get("name");
    const size = Number(formData.get("size"));
    const document = await upsertDocument(client, {
      path: documentPath,
      name: typeof name === "string" && name ? name : "certificate.pdf",
      size: Number.isFinite(size) ? size : 0,
      sourceDocument: "Job",
      sourceDocumentId: fai.data.jobId,
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
    type,
    certificateNumber,
    specification,
    notes,
    supplierId,
    jobOperationId: operation.data.id,
    documentId: uploadedDocumentId,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return { success: false, message: insert.error.message };
  }

  const refreshed = await refreshFirstArticleProducts(
    getDatabaseClient(),
    client,
    { id, companyId, userId }
  );
  if (refreshed.error) {
    logger.error("Failed to refresh Form 2 after attaching a certificate", {
      error: refreshed.error,
      firstArticleInspectionId: id,
      companyId
    });
    return {
      success: false,
      message: `Certificate added, but Form 2 was not refreshed: ${refreshed.error.message}`
    };
  }

  return { success: true, message: "Certificate added" };
}
