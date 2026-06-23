import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  ensureFont,
  Footer,
  getSafeFontFamily,
  JobTravelerPageContent
} from "@carbon/documents/pdf";
import {
  collectSectionIds,
  interpolateContent,
  resolveTemplate,
  toDocumentTemplate
} from "@carbon/documents/template";
import type { JSONContent } from "@carbon/react";
import {
  flattenTree,
  generateBomIds,
  getPreferenceHeaders
} from "@carbon/utils";
import {
  Document,
  Page,
  renderToStream,
  StyleSheet
} from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import {
  getJob,
  getJobMethodTree,
  getJobOperationsByMethodId,
  getTrackedEntityByJobId
} from "~/modules/production/production.service";
import {
  getCompany,
  getDocumentTemplate,
  resolveSections
} from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {});
  const { locale } = getPreferenceHeaders(request);

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

  // Compute BOM IDs for all make methods
  const bomIdMap = new Map<string, string>();
  const methodTree = await getJobMethodTree(serviceRole, jobId);
  if (!methodTree.error && methodTree.data?.length > 0) {
    const flatMethods = flattenTree(methodTree.data[0]);
    const bomIds = generateBomIds(flatMethods);
    flatMethods.forEach((node, index) => {
      bomIdMap.set(node.data.jobMaterialMakeMethodId, bomIds[index]);
    });
  }

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
        batchNumber,
        bomId: bomIdMap.get(makeMethod.id)
      };
    })
  );

  // Resolve the customizable template (block order / visibility / font /
  // footer) and the shared header/footer sections.
  const documentTemplate = await getDocumentTemplate(
    serviceRole,
    companyId,
    "jobTraveler"
  );
  const templateConfig = toDocumentTemplate(
    documentTemplate.data,
    "jobTraveler"
  );
  const resolved = resolveTemplate("jobTraveler", templateConfig);
  const sections = await resolveSections(
    serviceRole,
    companyId,
    collectSectionIds(resolved)
  );
  await ensureFont(resolved.settings.fontFamily);

  const footerSectionContent = resolved.footerSectionId
    ? sections[resolved.footerSectionId]?.content
    : undefined;
  const footerContent = footerSectionContent
    ? interpolateContent(footerSectionContent, {
        "job.number": job.data.jobId ?? "",
        "company.name": company.data.name ?? ""
      })
    : undefined;
  const showFooter = resolved.footerSectionId !== null;

  const styles = StyleSheet.create({
    body: {
      fontFamily: getSafeFontFamily(resolved.settings.fontFamily),
      padding: "20px 40px 50px 40px",
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
            company={company.data as any}
            job={job.data}
            jobOperations={data.operations}
            customer={customer.data}
            item={data.item}
            batchNumber={data.batchNumber}
            bomId={data.bomId}
            locale={locale}
            notes={index === 0 ? jobNotes : undefined}
            thumbnail={data.thumbnail}
            methodRevision={data.makeMethod.version?.toString()}
            template={templateConfig}
            sections={sections}
          />
          {showFooter && (
            <Footer
              documentId={job.data.jobId}
              content={footerContent}
              showPageNumbers={resolved.settings.showPageNumbers}
              pageNumberFormat={resolved.settings.pageNumberFormat}
              showRegistrationLine={resolved.settings.showRegistrationLine}
            />
          )}
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
    "Content-Disposition": `inline; filename="${company.data.name} - ${job.data.jobId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
