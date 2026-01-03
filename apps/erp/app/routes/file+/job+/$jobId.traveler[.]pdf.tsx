import { getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { JobTravelerPageContent } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import {
  Document,
  Font,
  Page,
  renderToStream,
  StyleSheet
} from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "react-router";
import {
  getJob,
  getJobOperationsByMethodId,
  getTrackedEntityByJobId
} from "~/modules/production/production.service";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});

  const { jobId } = params;
  if (!jobId) throw new Error("Could not find job id");

  const serviceRole = await getCarbonServiceRole();

  // Get the job first
  const job = await getJob(serviceRole, jobId);
  if (job.error || !job.data) {
    console.error(job.error);
    throw new Error("Failed to load job");
  }

  // Verify job belongs to this company
  if (job.data.companyId !== companyId) {
    throw new Error("Job does not belong to this company");
  }

  // Get all make methods for this job
  const jobMakeMethods = await serviceRole
    .from("jobMakeMethod")
    .select("*, ...item(itemType:type)")
    .eq("jobId", jobId)
    .order("createdAt", { ascending: true });

  if (jobMakeMethods.error || !jobMakeMethods.data) {
    console.error(jobMakeMethods.error);
    throw new Error("Failed to load job make methods");
  }

  const company = await getCompany(serviceRole, job.data.companyId ?? "");
  if (company.error) {
    console.error(company.error);
    throw new Error("Failed to load company");
  }

  const customer = await serviceRole
    .from("customer")
    .select("*")
    .eq("id", job.data.customerId ?? "")
    .maybeSingle();

  // Get job notes if they exist
  const jobNotes = job.data.notes as JSONContent | undefined;

  // For each make method, get operations and item data
  const makeMethodsWithData = await Promise.all(
    jobMakeMethods.data.map(async (makeMethod) => {
      const [operations, item] = await Promise.all([
        getJobOperationsByMethodId(serviceRole, makeMethod.id),
        serviceRole
          .from("item")
          .select("*, modelUpload(thumbnailPath)")
          .eq("id", makeMethod.itemId ?? "")
          .single()
      ]);

      if (operations.error || !operations.data) {
        console.error(operations.error);
        throw new Error(
          `Failed to load operations for make method ${makeMethod.id}`
        );
      }

      if (item.error || !item.data) {
        console.error(item.error);
        throw new Error(`Failed to load item for make method ${makeMethod.id}`);
      }

      // Get thumbnail if it exists
      let thumbnail: string | null = null;
      if (item.data.thumbnailPath || item.data.modelUpload?.thumbnailPath) {
        thumbnail = await getBase64ImageFromSupabase(
          serviceRole,
          item.data.thumbnailPath ?? item.data.modelUpload?.thumbnailPath ?? ""
        );
      }

      // Get batch number if item is tracked
      let batchNumber: string | undefined;
      if (
        ["Batch", "Serial"].includes(item.data.itemTrackingType) &&
        makeMethod.parentMaterialId === null
      ) {
        const trackedEntity = await getTrackedEntityByJobId(
          serviceRole,
          job.data!.id!
        );
        if (!trackedEntity.error && trackedEntity.data) {
          batchNumber = trackedEntity.data.readableId ?? undefined;
        }
      }

      return {
        makeMethod,
        operations: operations.data,
        item: item.data,
        thumbnail,
        batchNumber
      };
    })
  );

  // Register fonts (same as Template component)
  Font.register({
    family: "Inter",
    fonts: [
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf"
      },
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuOKfMZhrib2Bg-4.ttf",
        fontWeight: 300
      },
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuI6fMZhrib2Bg-4.ttf",
        fontWeight: 500
      },
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf",
        fontWeight: 700
      },
      {
        src: "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuBWYMZhrib2Bg-4.ttf",
        fontWeight: 900
      }
    ]
  });

  const styles = StyleSheet.create({
    body: {
      fontFamily: "Inter",
      padding: "20px 40px",
      color: "#000000",
      backgroundColor: "#FFFFFF"
    }
  });

  // Render multiple pages - one per make method
  const stream = await renderToStream(
    <Document
      title="Job Traveler"
      author="Carbon"
      subject="Job Traveler"
      keywords="job traveler, manufacturing"
    >
      {makeMethodsWithData.map((data, index) => (
        <Page key={data.makeMethod.id} size="A4" style={styles.body}>
          <JobTravelerPageContent
            company={company.data}
            job={job.data}
            jobOperations={data.operations}
            customer={customer.data}
            item={data.item}
            batchNumber={data.batchNumber}
            notes={index === 0 ? jobNotes : undefined}
            thumbnail={data.thumbnail}
          />
        </Page>
      ))}
    </Document>
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
