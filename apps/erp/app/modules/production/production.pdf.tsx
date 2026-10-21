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
import {
  flattenTree,
  generateBomIds,
  groupBy,
  indexBy,
  pluckUnique
} from "@carbon/utils";
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
  getJobOperationsByMethodIds,
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

  const makeMethodIds = jobMakeMethods.data.map((method) => method.id);
  const itemIds = pluckUnique(jobMakeMethods.data, (method) => method.itemId);
  const rootMethod = jobMakeMethods.data.find(
    (method) => method.parentMaterialId === null
  );

  const [
    company,
    companySettings,
    customer,
    methodTree,
    documentTemplate,
    operations,
    items
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    client
      .from("customer")
      .select("*")
      .eq("id", job.data.customerId ?? "")
      .eq("companyId", companyId)
      .maybeSingle(),
    getJobMethodTree(client, jobId),
    getDocumentTemplate(client, companyId, "jobTraveler"),
    getJobOperationsByMethodIds(client, makeMethodIds, companyId),
    client
      .from("item")
      .select("*, modelUpload(thumbnailPath)")
      .in("id", itemIds)
      .eq("companyId", companyId)
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
  if (operations.error) {
    logger.error("Failed to load operations", { error: operations.error });
    throw new Error("Failed to load job operations");
  }
  if (items.error) {
    logger.error("Failed to load items", { error: items.error });
    throw new Error("Failed to load the job's items");
  }
  // Without its template the traveler prints the default one, which leaves
  // out work instructions; say so rather than print it silently.
  if (documentTemplate.error) {
    logger.error(
      "Failed to load the Job Traveler template; using the default",
      {
        companyId,
        jobId,
        error: documentTemplate.error
      }
    );
  }
  if (customer.error) {
    logger.error("Failed to load the job's customer", {
      companyId,
      jobId,
      error: customer.error
    });
  }

  const settings = companySettings.data as {
    includeMaterialsOnTraveler?: boolean | null;
    includeOperationsOnTraveler?: boolean | null;
  } | null;
  // Opt-in: a materials (BOM) section. Opt-out (defaults on): the operations.
  const includeMaterials = settings?.includeMaterialsOnTraveler ?? false;
  const includeOperations = settings?.includeOperationsOnTraveler ?? true;

  const itemById = indexBy(items.data, (item) => item.id);
  const rootItem = rootMethod ? itemById.get(rootMethod.itemId ?? "") : null;

  // Only loaded when the materials section is on; the batch or serial number
  // belongs to the item the job makes.
  const [jobMaterials, trackedEntity] = await Promise.all([
    includeMaterials
      ? client
          .from("jobMaterial")
          .select(
            "id, jobMakeMethodId, description, quantity, unitOfMeasureCode, methodType, item(readableIdWithRevision)"
          )
          .in("jobMakeMethodId", makeMethodIds)
          .eq("companyId", companyId)
          .order("order", { ascending: true })
      : null,
    rootItem && ["Batch", "Serial"].includes(rootItem.itemTrackingType)
      ? getTrackedEntityByJobId(client, jobId)
      : null
  ]);
  if (jobMaterials?.error) {
    logger.error("Failed to load job materials", { error: jobMaterials.error });
    throw new Error("Failed to load job materials");
  }
  const batchNumber = trackedEntity?.data?.readableId ?? undefined;

  const jobNotes = job.data.notes as JSONContent | undefined;

  const bomIdMap = new Map<string, string>();
  if (!methodTree.error && methodTree.data?.length > 0) {
    const flatMethods = flattenTree(methodTree.data[0]);
    const bomIds = generateBomIds(flatMethods);
    flatMethods.forEach((node, index) => {
      bomIdMap.set(node.data.jobMaterialMakeMethodId, bomIds[index]);
    });
  }

  const operationsByMethod = groupBy(
    operations.data ?? [],
    (operation) => operation.jobMakeMethodId ?? ""
  );
  const materialsByMethod = groupBy(
    jobMaterials?.data ?? [],
    (material) => material.jobMakeMethodId ?? ""
  );

  const makeMethodsWithData = await Promise.all(
    jobMakeMethods.data.map(async (makeMethod) => {
      const item = itemById.get(makeMethod.itemId ?? "");
      if (!item) {
        logger.error("Failed to load item", { itemId: makeMethod.itemId });
        throw new Error(`Failed to load item for make method ${makeMethod.id}`);
      }

      const thumbnailPath =
        item.thumbnailPath ?? item.modelUpload?.thumbnailPath ?? null;
      const thumbnail = thumbnailPath
        ? await getBase64ImageFromSupabase(client, thumbnailPath)
        : null;

      const materials: JobTravelerMaterial[] = (
        materialsByMethod[makeMethod.id] ?? []
      ).map((material) => ({
        id: material.id,
        itemReadableId: material.item?.readableIdWithRevision,
        description: material.description,
        quantity: material.quantity,
        unitOfMeasureCode: material.unitOfMeasureCode,
        methodType: material.methodType
      }));

      return {
        makeMethod,
        operations: operationsByMethod[makeMethod.id] ?? [],
        item,
        thumbnail,
        batchNumber: makeMethod === rootMethod ? batchNumber : undefined,
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
