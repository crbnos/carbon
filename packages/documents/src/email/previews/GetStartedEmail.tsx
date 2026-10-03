// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import GetStartedEmail from "../GetStartedEmail";

export default function GetStartedEmailPreview() {
  return (
    <GetStartedEmail
      firstName={"John"}
      academyUrl={"https://learn.carbon.ms"}
    />
  );
}
