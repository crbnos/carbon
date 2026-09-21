import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { BatchListMember } from "@carbon/documents/pdf";
import { BatchListPDF } from "@carbon/documents/pdf";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

const logger = getLogger("erp", "batch-list", "pdf");

export async function loader({ request, params }: LoaderFunctionArgs) {
  // Permissionless like the job traveler: shop-floor people without ERP
  // permissions still print the load sheet. Tenant safety comes from the
  // explicit companyId on every fetch below (service-role client).
  const { companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find batch id");

  const serviceRole = await getCarbonServiceRole();

  const batch = await serviceRole
    .from("jobOperationBatch")
    .select(
      "id, readableId, status, createdAt, process(name), workCenter(name)"
    )
    .eq("id", id)
    .eq("companyId", companyId)
    .single();
  if (batch.error || !batch.data) {
    logger.error("Failed to load batch", { error: batch.error });
    throw new Error("Failed to load batch");
  }

  const [company, members] = await Promise.all([
    getCompany(serviceRole, companyId),
    serviceRole
      .from("jobOperation")
      .select(
        "id, description, operationQuantity, workCenter(name), job(jobId), jobMakeMethod(item(readableIdWithRevision, name, thumbnailPath, modelUpload(thumbnailPath)))"
      )
      .eq("jobOperationBatchId", id)
      .eq("companyId", companyId)
  ]);

  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
    throw new Error("Failed to load company");
  }
  if (members.error) {
    logger.error("Failed to load batch members", { error: members.error });
    throw new Error("Failed to load batch members");
  }

  // Resolve each make-method item's thumbnail to a base64 data URL (the part
  // built by the operation, NOT the job's parent part). Dedupe by path so a
  // part shared across jobs in the load is downloaded once.
  const thumbnailPaths = new Set<string>();
  for (const m of members.data ?? []) {
    const path =
      m.jobMakeMethod?.item?.thumbnailPath ??
      m.jobMakeMethod?.item?.modelUpload?.thumbnailPath;
    if (path) thumbnailPaths.add(path);
  }
  const thumbnailByPath = new Map<string, string>();
  await Promise.all(
    [...thumbnailPaths].map(async (path) => {
      const dataUrl = await getBase64ImageFromSupabase(serviceRole, path);
      if (dataUrl) thumbnailByPath.set(path, dataUrl);
    })
  );

  const { locale } = getPreferenceHeaders(request);

  // Header work center when assigned; else the members' shared one (a
  // board-created batch has no header WC until its card is dragged).
  const memberWorkCenters = new Set(
    (members.data ?? []).map((m) => m.workCenter?.name).filter(Boolean)
  );
  const workCenterName =
    batch.data.workCenter?.name ??
    (memberWorkCenters.size === 1
      ? ([...memberWorkCenters][0] as string)
      : null);

  const stream = await renderToStream(
    <BatchListPDF
      // The documents Company type is the `companies` view row; getCompany
      // returns the base table row (same fields the Header reads). Same cast
      // the traveler route uses.
      // biome-ignore lint/suspicious/noExplicitAny: view-vs-table row shape
      company={company.data as any}
      batch={{
        readableId: batch.data.readableId,
        status: batch.data.status,
        createdAt: batch.data.createdAt
      }}
      processName={batch.data.process?.name ?? null}
      workCenterName={workCenterName}
      members={(members.data ?? [])
        .map((m): BatchListMember => {
          const thumbnailPath =
            m.jobMakeMethod?.item?.thumbnailPath ??
            m.jobMakeMethod?.item?.modelUpload?.thumbnailPath;
          return {
            id: m.id,
            jobReadableId: m.job?.jobId ?? null,
            itemReadableId:
              m.jobMakeMethod?.item?.readableIdWithRevision ?? null,
            itemDescription: m.jobMakeMethod?.item?.name ?? null,
            operationDescription: m.description,
            quantity: m.operationQuantity,
            thumbnail: thumbnailPath
              ? (thumbnailByPath.get(thumbnailPath) ?? null)
              : null
          };
        })
        .sort((a, b) =>
          (a.jobReadableId ?? "").localeCompare(b.jobReadableId ?? "")
        )}
      locale={locale}
    />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - ${batch.data.readableId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
