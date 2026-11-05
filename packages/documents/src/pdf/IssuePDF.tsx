// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Fragment } from "react";
import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  issueTexts,
  resolveTemplate,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import { documentChrome } from "./blocks/documentChrome";
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
  valueCollector?: ValueCollector;
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
  valueCollector,
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
  template,
  sections = {}
}: IssuePDFProps) => {
  const resolved = resolveTemplate("issue", template ?? null);
  const values = documentValues(resolved.settings.valueEdits, valueCollector);
  const vars = values.document(
    buildIssueVars({
      nonConformance,
      nonConformanceTypes,
      assignees,
      company,
      locale
    })
  );
  const {
    dt,
    documentTitle,
    documentNumber,
    footerText,
    headerOptions,
    headerContent,
    footerContent,
    showFooter,
    visibleBlocks
  } = documentChrome({
    texts: issueTexts.document,
    settings: resolved.settings,
    vars,
    blocks: resolved.blocks,
    sections,
    headerSectionId: resolved.headerSectionId,
    footerSectionId: resolved.footerSectionId
  });

  const data: IssueData = {
    documentTitle,
    documentNumber,
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
    values,
    vars,
    headerOptions
  };

  return (
    <Template
      theme={resolved.theme}
      title={documentTitle}
      meta={{
        author: meta?.author ?? "Carbon",
        keywords: meta?.keywords ?? "issue report",
        subject: meta?.subject ?? documentTitle
      }}
      footerLabel={dt("issueNumber")}
      showFooter={showFooter}
      showPageNumbers={resolved.settings.showPageNumbers}
      pageNumberFormat={resolved.settings.pageNumberFormat}
      showRegistrationLine={resolved.settings.showRegistrationLine}
      fontFamily={resolved.settings.fontFamily}
      headerContent={headerContent}
      footerContent={footerContent}
      footerText={footerText}
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
