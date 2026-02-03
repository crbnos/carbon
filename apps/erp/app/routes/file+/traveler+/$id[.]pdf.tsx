import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { JobTravelerPDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { flattenTree, generateBomIds } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import {
  getJob,
  getJobMakeMethodById,
  getJobMethodTree,
  getJobOperationsByMethodId,
  getTrackedEntityByJobId
} from "~/modules/production/production.service";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";
import { getLocale } from "~/utils/request";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const { id } = params;
  if (!id) throw new Error("Could not find job make method id");

  const serviceRole = await getCarbonServiceRole();

  // we add the companyId to make sure we belong to the company
  // while allowing guys on the shop floor with no permissions to download the traveler
  const jobMakeMethod = await getJobMakeMethodById(serviceRole, id, companyId);
  if (jobMakeMethod.error) {
    console.error(jobMakeMethod.error);
    throw new Error("Failed to load job make method");
  }

  const [company, job] = await Promise.all([
    getCompany(serviceRole, jobMakeMethod.data?.companyId ?? ""),
    getJob(serviceRole, jobMakeMethod.data?.jobId ?? "")
  ]);

  if (company.error) {
    console.error(company.error);
    throw new Error("Failed to load company");
  }

  if (job.error || !job.data) {
    console.error(job.error);
    throw new Error("Failed to load job");
  }

  const [jobOperations, customer, item] = await Promise.all([
    getJobOperationsByMethodId(serviceRole, id),
    serviceRole
      .from("customer")
      .select("*")
      .eq("id", job.data.customerId ?? "")
      .maybeSingle(),
    serviceRole
      .from("item")
      .select("*, modelUpload(thumbnailPath)")
      .eq("id", jobMakeMethod.data.itemId ?? "")
      .single()
  ]);

  if (jobOperations.error || !jobOperations.data) {
    console.error(jobOperations.error);
    throw new Error("Failed to load job operations");
  }

  if (item.error || !item.data) {
    console.error(item.error);
    throw new Error("Failed to load item");
  }

  let batchNumber: string | undefined;
  if (["Batch", "Serial"].includes(item.data.itemTrackingType)) {
    const trackedEntity = await getTrackedEntityByJobId(
      serviceRole,
      job.data.id!
    );
    if (trackedEntity.error) {
      console.error(trackedEntity.error);
      throw new Error("Failed to load tracked entity");
    }
    batchNumber = trackedEntity.data?.readableId ?? undefined;
  }

  // Get job notes if they exist
  const jobNotes = job.data.notes as JSONContent | undefined;

  // Compute BOM ID for this make method
  let bomId: string | undefined;
  const methodTree = await getJobMethodTree(serviceRole, job.data.id!);
  if (!methodTree.error && methodTree.data?.length > 0) {
    const flatMethods = flattenTree(methodTree.data[0]);
    const bomIds = generateBomIds(flatMethods);
    // Find the node matching this make method
    const nodeIndex = flatMethods.findIndex(
      (node) => node.data.jobMaterialMakeMethodId === id
    );
    if (nodeIndex >= 0) {
      bomId = bomIds[nodeIndex];
    }
  }

  // Get thumbnail if it exists
  let thumbnail: string | null = null;
  if (item.data.thumbnailPath || item.data.modelUpload?.thumbnailPath) {
    thumbnail = await getBase64ImageFromSupabase(
      serviceRole,
      item.data.thumbnailPath ?? item.data.modelUpload?.thumbnailPath ?? ""
    );
  }

  const locale = getLocale(request);

  const stream = await renderToStream(
    <JobTravelerPDF
      company={company.data}
      job={job.data}
      jobMakeMethod={jobMakeMethod.data}
      jobOperations={jobOperations.data}
      customer={customer.data}
      item={item.data}
      batchNumber={batchNumber}
      bomId={bomId}
      locale={locale}
      meta={{
        author: "Carbon",
        keywords: "job traveler, manufacturing",
        subject: "Job Traveler"
      }}
      notes={jobNotes}
      thumbnail={thumbnail}
      title="Job Traveler"
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
    "Content-Disposition": `inline; filename="${job.data.jobId}.pdf"`
  });
  return new Response(body, { status: 200, headers });
}
