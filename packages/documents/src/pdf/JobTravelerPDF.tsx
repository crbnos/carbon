import type { Database } from "@carbon/database";
import type { JSONContent } from "@carbon/react";
import { View } from "@react-pdf/renderer";
import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { PDF } from "../types";
import type { JobTravelerData } from "./blocks/jobTraveler";
import {
  buildJobTravelerVars,
  jobTravelerBlockRegistry
} from "./blocks/jobTraveler";
import { tw } from "./blocks/jobTraveler/tw";
import { Template } from "./components";

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
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
}

type PageContentProps = Omit<
  JobTravelerProps,
  "meta" | "title" | "jobMakeMethod"
> & {
  methodRevision?: string | null;
};

/** Build the data bag every Job Traveler block renderer reads from. */
function buildData(
  props: PageContentProps,
  template: DocumentTemplate
): JobTravelerData {
  const { sections = {} } = props;
  const vars = buildJobTravelerVars(props);
  const headerOptions = {
    ...DEFAULT_HEADER_OPTIONS,
    ...(template.headerSectionId
      ? (sections[template.headerSectionId]?.config ?? {})
      : {})
  };
  return {
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
    theme: template.theme,
    sections,
    vars,
    headerOptions
  };
}

/**
 * Block-driven page body (no Document/Template wrapper) so the multi-make-method
 * route can render one of these per `<Page>`. Resolves the stored template and
 * maps each visible block through the registry.
 */
export const JobTravelerPageContent = (props: PageContentProps) => {
  const resolved = resolveTemplate("jobTraveler", props.template ?? null);
  const data = buildData(props, resolved);
  const showHeader = resolved.headerSectionId !== null;
  const visibleBlocks = resolved.blocks.filter(
    (block) => block.visible && !(block.type === "header" && !showHeader)
  );

  return (
    <View style={tw("flex flex-col")}>
      {visibleBlocks.map((block) => {
        const render = jobTravelerBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
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
  title = "Job Traveler",
  template,
  sections = {}
}: JobTravelerProps) => {
  const resolved = resolveTemplate("jobTraveler", template ?? null);
  const vars = buildJobTravelerVars({ job, item, customer, company });

  const headerSection = resolved.headerSectionId
    ? sections[resolved.headerSectionId]?.content
    : undefined;
  const footerSection = resolved.footerSectionId
    ? sections[resolved.footerSectionId]?.content
    : undefined;
  const headerContent = headerSection
    ? interpolateContent(headerSection, vars)
    : undefined;
  const footerContent = footerSection
    ? interpolateContent(footerSection, vars)
    : undefined;

  return (
    <Template
      theme={resolved.theme}
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "job traveler, manufacturing",
        subject: meta?.subject ?? "Job Traveler"
      }}
      footerDocumentId={job?.jobId}
      showFooter={resolved.footerSectionId !== null}
      showPageNumbers={resolved.settings.showPageNumbers}
      pageNumberFormat={resolved.settings.pageNumberFormat}
      showRegistrationLine={resolved.settings.showRegistrationLine}
      fontFamily={resolved.settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
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
        methodRevision={jobMakeMethod?.version?.toString()}
        template={template}
        sections={sections}
      />
    </Template>
  );
};

export default JobTravelerPDF;
