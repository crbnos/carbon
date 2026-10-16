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
  }
};
