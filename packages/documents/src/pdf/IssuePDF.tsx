import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  DEFAULT_HEADER_OPTIONS,
  interpolateContent,
  resolveTemplate
} from "../template";
import type { PDF } from "../types";
import type {
  ActionTask,
  Associations,
  IssueData,
  IssueItem,
  JobOperationStepWithRecords,
  ListItem
} from "./blocks/issue";
import { buildIssueVars, issueBlockRegistry } from "./blocks/issue";
import { Template } from "./components";

interface IssuePDFProps extends PDF {
  nonConformance: IssueData["nonConformance"];
  nonConformanceTypes: IssueData["nonConformanceTypes"];
  actionTasks: ActionTask[];
  requiredActions: ListItem[];
  reviewers: IssueData["reviewers"];
  items: IssueItem[];
  associations?: Associations | null;
  assignees?: Record<string, string>;
  jobOperationStepRecords?: JobOperationStepWithRecords[];
  operationToJobId?: Record<string, string>;
  template?: DocumentTemplate | null;
  sections?: Record<string, ResolvedSection>;
}

const IssuePDF = ({
  company,
  meta,
  nonConformance,
  nonConformanceTypes,
  actionTasks,
  requiredActions,
  reviewers,
  items,
  associations,
  assignees = {},
  jobOperationStepRecords = [],
  operationToJobId = {},
  locale,
  title = "Issue Report",
  template,
  sections = {}
}: IssuePDFProps) => {
  const resolved = resolveTemplate("issue", template ?? null);
  const vars = buildIssueVars({ nonConformance, company });

  const headerOptions = {
    ...DEFAULT_HEADER_OPTIONS,
    ...(resolved.headerSectionId
      ? (sections[resolved.headerSectionId]?.config ?? {})
      : {})
  };

  const data: IssueData = {
    company,
    locale,
    nonConformance,
    nonConformanceTypes,
    actionTasks,
    requiredActions,
    reviewers,
    items,
    associations,
    assignees,
    jobOperationStepRecords,
    operationToJobId,
    theme: resolved.theme,
    sections,
    vars,
    headerOptions
  };

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

  const showHeader = resolved.headerSectionId !== null;
  const visibleBlocks = resolved.blocks.filter(
    (block) => block.visible && !(block.type === "header" && !showHeader)
  );

  return (
    <Template
      theme={resolved.theme}
      title={title}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "issue report",
        subject: meta?.subject ?? "Issue Report"
      }}
      footerLabel={`Issue #${nonConformance.nonConformanceId}`}
      showFooter={resolved.footerSectionId !== null}
      showPageNumbers={resolved.settings.showPageNumbers}
      pageNumberFormat={resolved.settings.pageNumberFormat}
      showRegistrationLine={resolved.settings.showRegistrationLine}
      fontFamily={resolved.settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
    >
      {visibleBlocks.map((block) => {
        const render = issueBlockRegistry[block.type];
        if (!render) return null;
        return <Fragment key={block.id}>{render({ block, data })}</Fragment>;
      })}
    </Template>
  );
};

export default IssuePDF;
