// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ImplementationHubEmail from "../ImplementationHubEmail";

export default function ImplementationHubEmailPreview() {
  return (
    <ImplementationHubEmail
      recipientName={"John Doe"}
      hubUrl={"https://app.carbon.ms/x/get-started"}
    />
  );
}
