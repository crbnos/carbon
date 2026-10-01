// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import MfaRequiredEmail from "../MfaRequiredEmail";

export default function MfaRequiredEmailPreview() {
  return (
    <MfaRequiredEmail
      recipientName={"John Doe"}
      companyName={"Acme Manufacturing"}
      setupUrl={"https://app.carbon.ms/x/account/security"}
    />
  );
}
