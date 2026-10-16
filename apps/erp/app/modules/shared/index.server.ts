// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  assignRecord,
  createImportLookups,
  createIssueFromSlack,
  createJiraIssue,
  createLinearIssue,
  enrollImplementationHub,
  importCsvFile,
  linkJiraIssue,
  linkLinearIssue,
  startStripeConnectOnboarding,
  unlinkJiraIssue,
  unlinkLinearIssue
} from "./shared.server";
import {
  deleteSavedViewTool,
  getBase64ImageFromSupabaseTool,
  getCountriesTool,
  getCustomerPortalsTool,
  getCustomerPortalTool,
  getEnforcementRuleAssignmentCountsTool,
  getEnforcementRulesTool,
  getEnforcementRuleTool,
  getExternalLinkTool,
  getModelByItemIdTool,
  getNotesTool,
  getTagsListTool,
  insertNoteTool,
  insertTagTool,
  updateSavedViewOrderTool,
  upsertSavedViewTool
} from "./shared.tools.server";

/** The shared module's operations, by entity. */
export const shared = {
  record: { assign: assignRecord },
  csvImport: { run: importCsvFile, createLookups: createImportLookups },
  implementationHub: { enroll: enrollImplementationHub },
  slack: { createIssue: createIssueFromSlack },
  stripeConnect: { startOnboarding: startStripeConnectOnboarding },
  jira: {
    createIssue: createJiraIssue,
    linkIssue: linkJiraIssue,
    unlinkIssue: unlinkJiraIssue
  },
  linear: {
    createIssue: createLinearIssue,
    linkIssue: linkLinearIssue,
    unlinkIssue: unlinkLinearIssue
  },
  savedView: {
    delete: deleteSavedViewTool,
    upsert: upsertSavedViewTool
  },
  base64ImageFromSupabase: {
    get: getBase64ImageFromSupabaseTool
  },
  countries: {
    get: getCountriesTool
  },
  modelByItemId: {
    get: getModelByItemIdTool
  },
  notes: {
    get: getNotesTool
  },
  tagsList: {
    get: getTagsListTool
  },
  note: {
    insert: insertNoteTool
  },
  tag: {
    insert: insertTagTool
  },
  externalLink: {
    get: getExternalLinkTool
  },
  customerPortals: {
    get: getCustomerPortalsTool
  },
  customerPortal: {
    get: getCustomerPortalTool
  },
  savedViewOrder: {
    update: updateSavedViewOrderTool
  },
  enforcementRules: {
    get: getEnforcementRulesTool
  },
  enforcementRule: {
    get: getEnforcementRuleTool
  },
  enforcementRuleAssignmentCounts: {
    get: getEnforcementRuleAssignmentCountsTool
  }
};
