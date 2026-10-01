// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ChangelogEntryEmail from "./ChangelogEntryEmail";
import CompanyDeletionWarningEmail from "./CompanyDeletionWarningEmail";
import GetStartedEmail from "./GetStartedEmail";
import ImplementationHubEmail from "./ImplementationHubEmail";
import InviteEmail from "./InviteEmail";
import MfaEnabledEmail from "./MfaEnabledEmail";
import MfaRequiredEmail from "./MfaRequiredEmail";
import NotificationEmail from "./NotificationEmail";
import PurchaseOrderEmail from "./PurchaseOrderEmail";
import QuoteEmail from "./QuoteEmail";
import SalesInvoiceEmail from "./SalesInvoiceEmail";
import SalesOrderEmail from "./SalesOrderEmail";
import VerificationEmail from "./VerificationEmail";
import WeeklyReminderEmail from "./WeeklyReminderEmail";
import WelcomeEmail from "./WelcomeEmail";

export {
  isReminderItemStatus,
  type ReminderItemStatus,
  reminderItemStatuses
} from "./WeeklyReminderEmail";

export {
  ChangelogEntryEmail,
  CompanyDeletionWarningEmail,
  GetStartedEmail,
  ImplementationHubEmail,
  InviteEmail,
  MfaEnabledEmail,
  MfaRequiredEmail,
  NotificationEmail,
  PurchaseOrderEmail,
  QuoteEmail,
  SalesInvoiceEmail,
  SalesOrderEmail,
  VerificationEmail,
  WeeklyReminderEmail,
  WelcomeEmail
};
