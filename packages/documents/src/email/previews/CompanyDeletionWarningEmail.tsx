// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import CompanyDeletionWarningEmail from "../CompanyDeletionWarningEmail";

export default function CompanyDeletionWarningEmailPreview() {
  return (
    <CompanyDeletionWarningEmail
      recipientName={"John"}
      companyName={"Acme Manufacturing"}
      deletionDate={"October 11, 2026"}
      billingUrl={"https://app.carbon.ms/x/settings/billing"}
    />
  );
}
