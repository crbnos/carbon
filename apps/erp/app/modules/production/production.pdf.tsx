// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JobTravelerMaterial } from "@carbon/documents/pdf";
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
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import { flattenTree, generateBomIds } from "@carbon/utils";
import {
  Document,
  Page,
  renderToStream,
  StyleSheet
} from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCompany,
  getCompanySettings,
  getDocumentTemplate,
  resolveSections
} from "~/modules/settings/settings.service";
import { getBase64ImageFromSupabase } from "~/modules/shared/shared.service";
import {
  getJob,
  getJobOperationsByMethodId,
  getTrackedEntityByJobId
} from "./production.service";
import { getJobMethodTree } from "./production.utils";

const logger = getLogger("erp", "production", "pdf");

/**
 * A job's traveler: one page per make method, or only `jobMakeMethodId`'s page.
 * Both traveler routes render through here, so the company's Job Traveler
 * template (blocks, work instructions, header, footer, font) and its traveler
 * settings apply to every link. Throws a 404 for a job or method of another
 * company, and an error when a record cannot be read.
 */
export async function renderJobTravelerPdf(
  client: SupabaseClient<Database>,
  {
    companyId,
    jobId,
    jobMakeMethodId,
    locale
  }: {
    companyId: string;
    jobId: string;
    jobMakeMethodId?: string;
    locale: string;
  }
): Promise<{ body: Buffer; fileName: string }> {
  const job = await getJob(client, jobId);
  if (job.error || !job.data) {
    logger.error("Failed to load job", { error: job.error });
    throw new Error("Failed to load job");
  }
  // Every read below is keyed off this job and runs as the service role.
  if (job.data.companyId !== companyId) {
    logger.error("Job does not belong to this company", { companyId, jobId });
    throw new Response("Not found", { status: 404 });
  }

  let makeMethodQuery = client
    .from("jobMakeMethod")
    .select("*, ...item(itemType:type)")
    .eq("jobId", jobId)
    .eq("companyId", companyId);
  if (jobMakeMethodId) {
    makeMethodQuery = makeMethodQuery.eq("id", jobMakeMethodId);
  }
  const jobMakeMethods = await makeMethodQuery.order("createdAt", {
    ascending: true
  });
  if (jobMakeMethods.error) {
    logger.error("Failed to load jobMakeMethods", {
      error: jobMakeMethods.error
    });
    throw new Error("Failed to load job make methods");
  }
  if (jobMakeMethods.data.length === 0) {
    throw new Response("Not found", { status: 404 });
  }

  const [company, companySettings, customer, methodTree, documentTemplate] =
    await Promise.all([
      getCompany(client, companyId),
      getCompanySettings(client, companyId),
      client
        .from("customer")
        .select("*")
        .eq("id", job.data.customerId ?? "")
        .maybeSingle(),
      getJobMethodTree(client, jobId),
      getDocumentTemplate(client, companyId, "jobTraveler")
    ]);
  if (company.error) {
    logger.error("Failed to load company", { error: company.error });
    throw new Error("Failed to load company");
  }
  if (companySettings.error) {
    logger.error("Failed to load company settings", {
      error: companySettings.error
    });
    throw new Error("Failed to load company settings");
  }

  const settings = companySettings.data as {
    includeMaterialsOnTraveler?: boolean | null;
    includeOperationsOnTraveler?: boolean | null;
  } | null;
  // Opt-in: a materials (BOM) section. Opt-out (defaults on): the operations.
  const includeMaterials = settings?.includeMaterialsOnTraveler ?? false;
  const includeOperations = settings?.includeOperationsOnTraveler ?? true;

  const jobNotes = job.data.notes as JSONContent | undefined;

  const bomIdMap = new Map<string, string>();
  if (!methodTree.error && methodTree.data?.length > 0) {
    const flatMethods = flattenTree(methodTree.data[0]);
    const bomIds = generateBomIds(flatMethods);
    flatMethods.forEach((node, index) => {
      bomIdMap.set(node.data.jobMaterialMakeMethodId, bomIds[index]);
    });
  }

  const makeMethodsWithData = await Promise.all(
    jobMakeMethods.data.map(async (makeMethod) => {
      const [operations, item] = await Promise.all([
        getJobOperationsByMethodId(client, makeMethod.id),
        client
          .from("item")
          .select("*, modelUpload(thumbnailPath)")
          .eq("id", makeMethod.itemId ?? "")
          .single()
      ]);

      if (operations.error || !operations.data) {
        logger.error("Failed to load operations", { error: operations.error });
        throw new Error(
          `Failed to load operations for make method ${makeMethod.id}`
        );
      }
      if (item.error || !item.data) {
        logger.error("Failed to load item", { error: item.error });
        throw new Error(`Failed to load item for make method ${makeMethod.id}`);
      }

      let thumbnail: string | null = null;
      if (item.data.thumbnailPath || item.data.modelUpload?.thumbnailPath) {
        thumbnail = await getBase64ImageFromSupabase(
          client,
          item.data.thumbnailPath ?? item.data.modelUpload?.thumbnailPath ?? ""
        );
      }

      // The job's batch or serial number belongs to the item it makes.
      let batchNumber: string | undefined;
      if (
        ["Batch", "Serial"].includes(item.data.itemTrackingType) &&
        makeMethod.parentMaterialId === null
      ) {
        const trackedEntity = await getTrackedEntityByJobId(client, jobId);
        if (!trackedEntity.error && trackedEntity.data) {
          batchNumber = trackedEntity.data.readableId ?? undefined;
        }
      }

      // Only load BOM lines when the materials section is on.
      let materials: JobTravelerMaterial[] = [];
      if (includeMaterials) {
        const jobMaterials = await client
          .from("jobMaterial")
          .select(
            "id, description, quantity, unitOfMeasureCode, methodType, item(readableIdWithRevision)"
          )
          .eq("jobMakeMethodId", makeMethod.id)
          .eq("companyId", companyId)
          .order("order", { ascending: true });

        if (jobMaterials.error) {
          logger.error("Failed to load job materials", {
            error: jobMaterials.error
          });
          throw new Error(
            `Failed to load materials for make method ${makeMethod.id}`
          );
        }

        materials = (jobMaterials.data ?? []).map((material) => ({
          id: material.id,
          itemReadableId: material.item?.readableIdWithRevision,
          description: material.description,
          quantity: material.quantity,
          unitOfMeasureCode: material.unitOfMeasureCode,
          methodType: material.methodType
        }));
      }

      return {
        makeMethod,
        operations: operations.data,
        item: item.data,
        thumbnail,
        batchNumber,
        materials,
        bomId: bomIdMap.get(makeMethod.id)
      };
    })
  );

  const templateConfig = toDocumentTemplate(
    documentTemplate.data,
    "jobTraveler"
  );
  const resolved = resolveTemplate("jobTraveler", templateConfig);
  const sections = await resolveSections(
    client,
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
            includeMaterials={includeMaterials}
            includeOperations={includeOperations}
            materials={data.materials}
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

  return { body, fileName: `${company.data.name} - ${job.data.jobId}.pdf` };
}
