// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import MfaEnabledEmail from "../MfaEnabledEmail";

export default function MfaEnabledEmailPreview() {
  return (
    <MfaEnabledEmail
      recipientName={"Jane Doe"}
      securityUrl={"https://app.carbon.ms/x/account/security"}
    />
  );
}
