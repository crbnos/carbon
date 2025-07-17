import { requirePermissions } from "@carbon/auth/auth.server";
import { JobTravelerPDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@vercel/remix";
import {
  getJob,
  getJobMakeMethodById,
  getJobOperationsByMethodId,
  getTrackedEntityByJobId,
} from "~/modules/production/production.service";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";
import { getLocale } from "~/utils/request";

export const config = { runtime: "nodejs" };

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find job make method id");

  const jobMakeMethod = await getJobMakeMethodById(client, id);
  if (jobMakeMethod.error) {
    console.error(jobMakeMethod.error);
    throw new Error("Failed to load job make method");
  }

  const [company, job] = await Promise.all([
    getCompany(client, jobMakeMethod.data?.companyId ?? ""),
    getJob(client, jobMakeMethod.data?.jobId ?? ""),
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
    getJobOperationsByMethodId(client, id),
    client
      .from("customer")
      .select("*")
      .eq("id", job.data.customerId ?? "")
      .maybeSingle(),
    client
      .from("item")
      .select("*")
      .eq("id", jobMakeMethod.data.itemId ?? "")
      .single(),
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
    const trackedEntity = await getTrackedEntityByJobId(client, job.data.id!);
    if (trackedEntity.error) {
      console.error(trackedEntity.error);
      throw new Error("Failed to load tracked entity");
    }
    // @ts-ignore
    batchNumber = trackedEntity.data?.attributes["Batch Number"] as string;
  }

  // Get job notes if they exist
  const jobNotes = job.data.notes as JSONContent | undefined;

  // Get thumbnail if it exists
  let thumbnail: string | null = null;
  if (item.data.thumbnailPath) {
    thumbnail = await getBase64ImageFromSupabase(
      client,
      item.data.thumbnailPath
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
      locale={locale}
      meta={{
        author: "Carbon",
        keywords: "job traveler, manufacturing",
        subject: "Job Traveler",
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

  const headers = new Headers({ "Content-Type": "application/pdf" });
  return new Response(body, { status: 200, headers });
}
