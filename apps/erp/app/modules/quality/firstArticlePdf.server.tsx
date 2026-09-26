import type { Database } from "@carbon/database";
import type { FirstArticleInspectionPDFProps } from "@carbon/documents/pdf";
import { ensureFont, FirstArticleInspectionPDF } from "@carbon/documents/pdf";
import { datetime, formatDate } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getFirstArticleInspection } from "./quality.service";
import type { FirstArticleInspectionDetail } from "./types";

type Approval = { name: string; title: string | null; approvedAt: string };

/** The company-calendar date of a timestamp, formatted for the report. */
function reportDate(
  instant: string | null,
  timeZone: string,
  locale: string | undefined
): string | null {
  if (!instant) return null;
  return formatDate(
    datetime.businessDay(instant, timeZone).toString(),
    undefined,
    locale
  );
}

/**
 * The FAIR PDF's props from an FAI's detail. `approval` stamps fields 22/23
 * before the approval is written, so the stored record carries its own
 * signature; the DRAFT mark shows until the FAI is (being) approved.
 */
export function toFirstArticleInspectionPdfProps(
  detail: FirstArticleInspectionDetail,
  {
    timeZone,
    locale,
    approval
  }: { timeZone: string; locale?: string; approval?: Approval }
): FirstArticleInspectionPDFProps {
  const { firstArticle, lot } = detail;
  const approvedByName = approval?.name ?? firstArticle.approvedByName;
  const approvedByTitle = approval
    ? approval.title
    : firstArticle.approvedByTitle;
  const approvedAt = approval?.approvedAt ?? firstArticle.approvedAt;

  const baseline =
    firstArticle.scope === "Partial"
      ? [
          detail.baseline
            ? [
                detail.baseline.partNumber,
                detail.baseline.partRevision
                  ? `Rev ${detail.baseline.partRevision}`
                  : null,
                detail.baseline.fairIdentifier
                  ? `(${detail.baseline.fairIdentifier})`
                  : null
              ]
                .filter(Boolean)
                .join(" ")
            : null,
          firstArticle.baselineReference
        ]
          .filter(Boolean)
          .join("; ") || null
      : null;

  return {
    approved: !!approval || firstArticle.status === "Approved",
    header: {
      partNumber: firstArticle.partNumber,
      partName: firstArticle.partName,
      serialNumber: detail.serialNumber,
      fairIdentifier: lot.inspectionId,
      partRevision: firstArticle.partRevision,
      drawingNumber: firstArticle.drawingNumber,
      drawingRevision: firstArticle.drawingRevision,
      additionalChanges: firstArticle.additionalChanges,
      manufacturingProcessReference: firstArticle.manufacturingProcessReference,
      organizationName: firstArticle.organizationName,
      supplierCode: firstArticle.supplierCode,
      purchaseOrderNumber: firstArticle.purchaseOrderNumber,
      type: firstArticle.type,
      scope: firstArticle.scope,
      baseline,
      reason: firstArticle.reason,
      hasNonconformance: firstArticle.hasNonconformance,
      verifiedByName: firstArticle.verifiedByName,
      verifiedByTitle: firstArticle.verifiedByTitle,
      verifiedDate: reportDate(firstArticle.verifiedAt, timeZone, locale),
      approvedByName,
      approvedByTitle,
      approvedDate: reportDate(approvedAt, timeZone, locale),
      customerApprovalName: firstArticle.customerApprovalName,
      customerApprovalDate: firstArticle.customerApprovalDate
        ? formatDate(firstArticle.customerApprovalDate, undefined, locale)
        : null,
      comments: firstArticle.comments
    },
    index: detail.index.map((row) => ({
      partNumber: row.partNumber,
      partName: row.partName,
      partType: row.partType,
      fairIdentifier: row.fairIdentifier
    })),
    products: detail.products.map((product) => ({
      kind: product.kind,
      name: product.name,
      specification: product.specification,
      code: product.code,
      supplier: product.supplier,
      customerApprovalVerification: product.customerApprovalVerification,
      certificateNumber: product.certificateNumber,
      functionalTestProcedureNumber: product.functionalTestProcedureNumber,
      acceptanceReportNumber: product.acceptanceReportNumber,
      comments: product.comments
    })),
    characteristics: detail.characteristics.map((row) => ({
      characteristicNumber: row.characteristicNumber,
      referenceLocation: row.referenceLocation,
      designator: row.designator,
      requirement: row.requirement,
      results: row.results,
      tooling: row.notes,
      nonconformanceNumber: row.nonconformanceNumber,
      comments:
        row.status === "Pending"
          ? "Not inspected"
          : row.status === "Failed"
            ? "Nonconforming"
            : null
    }))
  };
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (chunk) => buffers.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(buffers)));
    stream.on("error", reject);
  });
}

/**
 * Renders an FAI's AS9102 report live from its current data. Used by the file
 * route before approval and by `approveFirstArticleInspection` to produce the
 * stored record.
 */
export async function renderFirstArticleInspectionPdf(
  client: SupabaseClient<Database>,
  args: {
    id: string;
    companyId: string;
    locale?: string;
    approval?: Approval;
  }
): Promise<
  | {
      data: {
        pdf: Buffer;
        firstArticle: FirstArticleInspectionDetail["firstArticle"];
        fairIdentifier: string;
      };
      error: null;
    }
  | { data: null; error: { message: string } }
> {
  const [detail, timeZone] = await Promise.all([
    getFirstArticleInspection(client, args.id, args.companyId),
    getCompanyTimeZone(client, args.companyId)
  ]);
  if (detail.error || !detail.data) {
    return {
      data: null,
      error: { message: detail.error?.message ?? "First article not found" }
    };
  }

  await ensureFont("Inter");
  const props = toFirstArticleInspectionPdfProps(detail.data, {
    timeZone,
    locale: args.locale,
    approval: args.approval
  });

  const stream = await renderToStream(<FirstArticleInspectionPDF {...props} />);
  const pdf = await streamToBuffer(stream);

  return {
    data: {
      pdf,
      firstArticle: detail.data.firstArticle,
      fairIdentifier: detail.data.lot.inspectionId
    },
    error: null
  };
}
