// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { View } from "@react-pdf/renderer";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  jobTravelerTexts,
  resolveTemplate,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import { DocumentPage } from "./blocks/DocumentPage";
import { documentChrome } from "./blocks/documentChrome";
import type {
  JobTravelerData,
  JobTravelerMaterial
} from "./blocks/jobTraveler";
import {
  buildJobTravelerVars,
  jobTravelerBlockRegistry,
  MaterialsBlock
} from "./blocks/jobTraveler";
import { tw } from "./blocks/jobTraveler/tw";

type JobOperationStep = Database["public"]["Tables"]["jobOperationStep"]["Row"];

type JobOperationWithSteps =
  Database["public"]["Tables"]["jobOperation"]["Row"] & {
    jobOperationStep?: JobOperationStep[];
  };

interface JobTravelerProps extends PDF {
  job: Database["public"]["Views"]["jobs"]["Row"];
  jobMakeMethod?: Database["public"]["Tables"]["jobMakeMethod"]["Row"];
  jobOperations: JobOperationWithSteps[];
  customer: Database["public"]["Tables"]["customer"]["Row"] | null;
  item: Database["public"]["Tables"]["item"]["Row"];
  batchNumber: string | undefined;
  bomId?: string;
  notes?: JSONContent;
  thumbnail?: string | null;
  includeMaterials?: boolean;
  includeOperations?: boolean;
  materials?: JobTravelerMaterial[];
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
  valueCollector?: ValueCollector;
}

type PageContentProps = Omit<JobTravelerProps, "meta" | "jobMakeMethod"> & {
  methodRevision?: string | null;
};

/** Build the data bag every Job Traveler block renderer reads from. */
function buildData(props: PageContentProps, template: DocumentTemplate) {
  const { sections = {} } = props;
  const values = documentValues(
    template.settings.valueEdits,
    props.valueCollector
  );
  const vars = values.document(buildJobTravelerVars(props));
  const {
    dt,
    documentTitle,
    documentNumber,
    headerOptions,
    visibleBlocks: printed
  } = documentChrome({
    texts: jobTravelerTexts.document,
    template,
    vars,
    sections
  });
  const data: JobTravelerData = {
    documentTitle,
    documentNumber,
    documentSubId: dt.prints("salesOrderPrefix")
      ? dt("salesOrderPrefix")
      : undefined,
    company: props.company,
    locale: props.locale,
    job: props.job,
    jobOperations: props.jobOperations,
    customer: props.customer,
    item: props.item,
    batchNumber: props.batchNumber,
    bomId: props.bomId,
    notes: props.notes,
    thumbnail: props.thumbnail,
    methodRevision: props.methodRevision,
    includeMaterials: props.includeMaterials,
    includeOperations: props.includeOperations,
    materials: props.materials,
    theme: template.theme,
    sections,
    vars,
    values,
    headerOptions
  };
  return { data, dt, printed };
}

/**
 * Block-driven page body (no Document/Template wrapper) so the multi-make-method
 * route can render one of these per `<Page>`. Resolves the stored template and
 * maps each visible block through the registry.
 */
export const JobTravelerPageContent = (props: PageContentProps) => {
  const resolved = resolveTemplate("jobTraveler", props.template ?? null);
  const { data, dt, printed } = buildData(props, resolved);
  // `includeOperations` is an opt-out company setting (undefined = shown).
  const visibleBlocks = printed.filter(
    (block) => block.type !== "operations" || data.includeOperations !== false
  );

  return (
    <View style={tw("flex flex-col")}>
      {visibleBlocks.map((block) => {
        const render = jobTravelerBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
      {data.includeMaterials ? <MaterialsBlock data={data} text={dt} /> : null}
    </View>
  );
};

const JobTravelerPDF = ({
  company,
  job,
  jobMakeMethod,
  jobOperations,
  customer,
  item,
  batchNumber,
  bomId,
  locale,
  meta,
  notes,
  thumbnail,
  includeMaterials,
  includeOperations,
  materials,
  template,
  sections = {},
  valueCollector
}: JobTravelerProps) => {
  const resolved = resolveTemplate("jobTraveler", template ?? null);
  const vars = documentValues(resolved.settings.valueEdits).document(
    buildJobTravelerVars({
      job,
      item,
      customer,
      company,
      jobOperations,
      batchNumber,
      methodRevision: jobMakeMethod?.version?.toString(),
      locale
    })
  );
  const chrome = documentChrome({
    texts: jobTravelerTexts.document,
    template: resolved,
    vars,
    sections
  });

  return (
    <DocumentPage
      chrome={chrome}
      template={resolved}
      meta={meta}
      keywords="job traveler, manufacturing"
      footerDocumentId={job?.jobId}
    >
      <JobTravelerPageContent
        company={company}
        job={job}
        jobOperations={jobOperations}
        customer={customer}
        item={item}
        batchNumber={batchNumber}
        bomId={bomId}
        locale={locale}
        notes={notes}
        thumbnail={thumbnail}
        includeMaterials={includeMaterials}
        includeOperations={includeOperations}
        materials={materials}
        methodRevision={jobMakeMethod?.version?.toString()}
        template={template}
        sections={sections}
        valueCollector={valueCollector}
      />
    </DocumentPage>
  );
};

export default JobTravelerPDF;
