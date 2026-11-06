// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { DocumentTemplate, ResolvedSection } from "../template";
import {
  documentValues,
  issueTexts,
  resolveTemplate,
  type ValueCollector
} from "../template";
import type { PDF } from "../types";
import { DocumentPage } from "./blocks/DocumentPage";
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
  const chrome = documentChrome({
    texts: issueTexts.document,
    template: resolved,
    vars,
    sections
  });
  const { dt, documentTitle, documentNumber, headerOptions } = chrome;

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
    <DocumentPage
      chrome={chrome}
      template={resolved}
      meta={meta}
      keywords="issue report"
      footerLabel={dt("issueNumber")}
      registry={issueBlockRegistry}
      data={data}
    />
  );
};

export default IssuePDF;
