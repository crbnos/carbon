import { requirePermissions } from "@carbon/auth/auth.server";
import { storage } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { renderFirstArticleInspectionPdf } from "~/modules/quality/firstArticlePdf.server";

const logger = getLogger("erp", "first-article", "pdf");

function pdfResponse(body: BodyInit, fileName: string) {
  return new Response(body, {
    status: 200,
    headers: new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`
    })
  });
}

// An approved FAI serves the PDF stored at approval — that file is the record,
// and later plan or data edits must not change it. Anything else renders live
// with a DRAFT mark.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const fai = await client
    .from("firstArticleInspection")
    .select("status, documentId, inspection(inspectionId)")
    .eq("id", id)
    .eq("companyId", companyId)
    .maybeSingle();
  if (fai.error || !fai.data) {
    logger.error("Failed to load first article", {
      error: fai.error,
      id,
      companyId
    });
    throw new Response("Not found", { status: 404 });
  }

  const fairIdentifier = fai.data.inspection?.inspectionId ?? id;

  if (fai.data.status === "Approved" && fai.data.documentId) {
    const document = await client
      .from("document")
      .select("path")
      .eq("id", fai.data.documentId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (document.error || !document.data?.path) {
      logger.error("Failed to load the approved FAIR document", {
        error: document.error,
        id,
        documentId: fai.data.documentId,
        companyId
      });
      throw new Response("Not found", { status: 404 });
    }

    const file = await storage(client)
      .company(companyId)
      .download(document.data.path);
    if (file.error || !file.data) {
      logger.error("Failed to download the approved FAIR", {
        error: file.error,
        id,
        path: document.data.path,
        companyId
      });
      throw new Response("Not found", { status: 404 });
    }

    return pdfResponse(
      new Uint8Array(await file.data.arrayBuffer()),
      `${fairIdentifier}.pdf`
    );
  }

  const { locale } = getPreferenceHeaders(request);
  const rendered = await renderFirstArticleInspectionPdf(client, {
    id,
    companyId,
    locale
  });
  if (rendered.error) {
    logger.error("Failed to render the FAIR", {
      error: rendered.error,
      id,
      companyId
    });
    throw new Response("Failed to render the report", { status: 500 });
  }

  return pdfResponse(
    new Uint8Array(rendered.data.pdf),
    fai.data.status === "Approved"
      ? `${fairIdentifier}.pdf`
      : `${fairIdentifier} DRAFT.pdf`
  );
}
